#!/usr/bin/env node
// Opt-in CI rehearsal of CLI 2.119.0 logical dumps through the reviewed age
// preparation/restore helpers. It uses two disposable, separate local stacks.
// The only fake Supabase project reference is consumed by the strict CLI shim;
// that shim rewrites only approved dump calls to the source stack's --local.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = spawnSync('which', ['supabase'], { encoding: 'utf8' });
const realCli = cliPath.status === 0 ? cliPath.stdout.trim() : '';
const projectIds = [`hrbs${randomBytes(6).toString('hex')}`, `hrbt${randomBytes(6).toString('hex')}`];
const fakeRef = 'abcdefghijklmnopqrst';
const targetDb = 'hr_restore_synthetic';
const migrationSources = [
  ['20261001000100_hr_foundation.sql', 'database/hr_foundation.sql'],
  ['20261001000200_hr_accounts.sql', 'database/hr_accounts.sql'],
  ['20261001000300_phase3_employees.sql', 'database/phase3_employees.sql'],
  ['20261001000400_phase4_leave_policy.sql', 'database/phase4_leave_policy.sql'],
  ['20261001000500_phase5_leave_entries.sql', 'database/phase5_leave_entries.sql'],
  ['20261001000600_phase5_request_ledger_guards.sql', 'database/phase5_request_ledger_guards.sql'],
];
let work;
let active = new Set();
let sourceDir;
let targetDir;
let identityCreated = false;
let successMessage;

function die(message) { throw new Error(message); }
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PG|SUPABASE_|DATABASE_URL$|DIRECT_URL$|DB_URL$|SQL|POSTGRES_|MYSQL_|MARIADB_|MONGO(?:DB)?_|REDIS_|AWS_|AZURE_|GOOGLE_|GCLOUD_|GCP_|CLOUDSDK_|CLOUD_SQL_|CLOUDINARY_|NEON_|TURSO_|FLY_|VERCEL_|NETLIFY_|RAILWAY_|HEROKU_|DOCKER_HOST$|DOCKER_CONTEXT$|KUBECONFIG$|KUBE_)/i.test(k)));
  return { ...env, ...extra };
}
function run(command, args, { cwd = root, env = cleanEnv(), input, timeout = 120000, failure = 'rehearsal command failed' } = {}) {
  const r = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) die(failure);
  return r.stdout;
}
function sqlLit(s) { return `'${s.replaceAll("'", "''")}'`; }
function psql(db, sql) {
  const result = run('psql', ['--no-psqlrc', '--no-password', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--host=127.0.0.1', '--port=54322', '--username=postgres', '--dbname', db, '--command', sql], {
    env: cleanEnv({ PGPASSWORD: 'postgres' }), timeout: 45000, failure: 'synthetic SQL phase failed',
  });
  return result.trim();
}
function supabase(dir, args, failure = 'local Supabase operation failed', timeout = 900000) {
  return run(realCli, ['--workdir', dir, ...args], { timeout, failure });
}
function labelValue(output, key) {
  const line = output.split(/\r?\n/).find(x => x.startsWith(`${key}=`));
  if (!line) die('local Supabase status omitted a required endpoint');
  return line.slice(key.length + 1).replace(/^['"]|['"]$/g, '');
}
function parseStatus(output) {
  const result = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}
async function createSyntheticAuthUser(apiUrl, serviceKey, email) {
  const password = `${randomBytes(30).toString('base64url')}Aa1!`;
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: 'Synthetic Backup Rehearsal' } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('local synthetic Auth fixture creation failed');
  const user = await response.json();
  if (!/^[0-9a-f-]{36}$/i.test(user.id ?? '') || user.email !== email) throw new Error('local Auth returned an invalid synthetic identity');
  return user.id;
}
function assertContainer(projectId, workdir) {
  const name = `supabase_db_${projectId}`;
  const id = run('docker', ['ps', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'], { failure: 'expected isolated database container is unavailable' }).trim();
  if (!id || id.includes('\n')) die('expected exactly one isolated database container');
  const inspect = JSON.parse(run('docker', ['inspect', id], { failure: 'cannot inspect isolated database container' }))[0];
  const labels = inspect.Config?.Labels ?? {};
  if (labels['com.supabase.cli.project'] !== projectId) die('local database container project label mismatch');
  if (labels['com.supabase.cli.workdir'] && resolve(labels['com.supabase.cli.workdir']) !== resolve(workdir)) die('local database container workdir label mismatch');
  if (!String(inspect.Config?.Image ?? '').includes('supabase/postgres:17')) die('local database image is not PostgreSQL 17 compatible');
  if (!run('docker', ['exec', id, 'pg_dump', '--version'], { failure: 'cannot inspect container pg_dump version' }).match(/ 17\./)
      || !run('docker', ['exec', id, 'psql', '--version'], { failure: 'cannot inspect container psql version' }).match(/ 17\./)) die('container PostgreSQL tools are not version 17');
  return { id, name };
}
function assertStopped(projectId) {
  const remaining = run('docker', ['ps', '--filter', `name=^/supabase_db_${projectId}$`, '--format', '{{.ID}}'], { failure: 'cannot verify local database stack shutdown' }).trim();
  if (remaining) die('local database container remained active after stop');
}
async function writeProject(dir, projectId, withMigrations) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  run(realCli, ['--workdir', dir, 'init'], { failure: 'Supabase CLI project initialization failed' });
  const config = `project_id = "${projectId}"
[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[db]
port = 54322
shadow_port = 54320
major_version = 17
[auth]
enabled = true
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["http://127.0.0.1:3000"]
enable_signup = true
jwt_expiry = 3600
[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false
  `;
  await writeFile(join(dir, 'supabase/config.toml'), config, { mode: 0o600 });
  await mkdir(join(dir, 'supabase/migrations'), { recursive: true, mode: 0o700 });
  if (withMigrations) for (const [name, source] of migrationSources) await copyFile(join(root, source), join(dir, 'supabase/migrations', name));
}
function strictSupabaseShim(path, { sourceWorkdir, tempRoot }) {
  const body = `#!/usr/bin/env node
const {spawnSync}=require('node:child_process');
const real=${JSON.stringify(realCli)}, work=${JSON.stringify(sourceWorkdir)}, tmp=${JSON.stringify(tempRoot)}, ref=${JSON.stringify(fakeRef)};
const a=process.argv.slice(2);
const fail=()=>{process.stderr.write('strict local dump adapter refused arguments\\n');process.exit(64)};
if(a.length===1&&a[0]==='--version'){const r=spawnSync(real,['--version'],{encoding:'utf8'});if(r.status!==0)process.exit(r.status||1);process.stdout.write(r.stdout);process.exit(0)}
if(a[0]!=='db'||a[1]!=='dump')fail();
let file=null,role=false,data=false,useCopy=false,schema=null,seenUrl=false,exclude=[];const expectedUrl='postgresql://postgres@db.'+ref+'.supabase.co:5432/postgres';
for(let i=2;i<a.length;i++){const x=a[i];if(x==='--db-url'){if(seenUrl||a[++i]!==expectedUrl)fail();seenUrl=true}
else if(x==='--file'){if(file)fail();file=a[++i];if(!file||!file.startsWith(tmp+'/')||file.includes('..'))fail()}
else if(x==='--role-only'){if(role||data||schema)fail();role=true}
else if(x==='--data-only'){if(data||role)fail();data=true}
else if(x==='--use-copy'){if(useCopy)fail();useCopy=true}
else if(x==='--schema'){if(schema)fail();schema=a[++i];if(schema!=='supabase_migrations')fail()}
else if(x==='--exclude'){const e=a[++i];if(!['storage.buckets_vectors','storage.vector_indexes'].includes(e)||exclude.includes(e))fail();exclude.push(e)}
else fail()}
if(!file||!seenUrl)fail();
const base=file.slice(file.lastIndexOf('/')+1);
const approved={ 'roles.sql':role&&!data&&!schema&&!useCopy&&!exclude.length, 'schema.sql':!role&&!data&&!schema&&!useCopy&&!exclude.length, 'data.sql':!role&&data&&!schema&&useCopy&&exclude.length===2, 'migration-history-schema.sql':!role&&!data&&schema==='supabase_migrations'&&!useCopy&&!exclude.length, 'migration-history-data.sql':!role&&data&&schema==='supabase_migrations'&&useCopy&&!exclude.length };
if(!approved[base])fail();
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!(/^(PG|SUPABASE_|AWS_|AZURE_|GOOGLE_|GCLOUD_|GCP_|CLOUDSDK_|SQL)/i.test(k))));
const rewritten=['--workdir',work,'db','dump','--local','--file',file,...(role?['--role-only']:[]),...(data?['--data-only']:[]),...(useCopy?['--use-copy']:[]),...(schema?['--schema',schema]:[]),...exclude.flatMap(e=>['--exclude',e])];
const r=spawnSync(real,rewritten,{stdio:'inherit',env:{...env,PGPASSWORD:'postgres'}});
process.exit(r.status??1);
`;
  return writeFile(path, body, { mode: 0o700 });
}
function dedicateManagedBaseline(container) {
  // Keep the initialized managed objects, owners, extension configuration and
  // ACLs intact. Replaying their schema as the restricted postgres role is not
  // equivalent to provisioning Supabase. This target cluster is disposable.
  if (psql('postgres', "select (select count(*) from auth.users) || ':' || (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','hr_private') and c.relkind in ('r','p','v','m','S','f'))") !== '0:0') die('target managed baseline is not pristine');
  if (psql('postgres', `select count(*) filter (where datname='postgres') || ':' || count(*) filter (where datname='${targetDb}') from pg_database`) !== '1:0') die('target database dedication would collide with an existing database');
  const admin = sql => run('docker', ['exec', container.id, 'psql', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'template1', '--command', sql], { failure: 'isolated managed database dedication failed' });
  admin('ALTER DATABASE postgres ALLOW_CONNECTIONS false');
  admin("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres'");
  admin(`ALTER DATABASE postgres RENAME TO ${targetDb}`);
  admin(`ALTER DATABASE ${targetDb} ALLOW_CONNECTIONS true`);
  if (psql(targetDb, 'select current_database()') !== targetDb) die('dedicated initialized target database is unavailable');
}

async function main() {
  if (process.argv.length !== 2) die('this CI-only rehearsal accepts no arguments');
  if (process.env.GITHUB_ACTIONS !== 'true') die('run only in an isolated GitHub Actions runner');
  if (!realCli || !/^2\.119\.0\s*$/.test(run(realCli, ['--version']).trim())) die('Supabase CLI 2.119.0 is required');
  if (!run('psql', ['--version']).match(/^psql \(PostgreSQL\) 17\./)) die('PostgreSQL 17 psql is required');
  if (!run('age', ['--version'])) die('age is required');
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !resolve(runnerTemp).startsWith('/')) die('RUNNER_TEMP must be an absolute runner-owned path');
  work = await mkdtemp(join(runnerTemp, 'hr-cli-backup-roundtrip-'));
  await chmod(work, 0o700);
  sourceDir = join(work, 'source'); targetDir = join(work, 'target');
  const privateDir = join(work, 'private'); await mkdir(privateDir, { mode: 0o700 });
  const keyFile = join(privateDir, 'age-identity.txt');
  run('age-keygen', ['-o', keyFile], { failure: 'ephemeral age identity generation failed' });
  identityCreated = true;
  const recipient = run('age-keygen', ['-y', keyFile], { failure: 'cannot derive age public recipient' }).trim();
  if (!recipient) die('age-keygen did not return a valid public recipient');

  await writeProject(sourceDir, projectIds[0], true);
  await writeProject(targetDir, projectIds[1], false);
  active.add(sourceDir);
  supabase(sourceDir, ['start'], 'source Supabase stack failed to start');
  assertContainer(projectIds[0], sourceDir);
  const sourceStatus = supabase(sourceDir, ['status', '-o', 'env'], 'source status failed');
  const sourceDb = labelValue(sourceStatus, 'DB_URL');
  if (sourceDb !== 'postgresql://postgres:postgres@127.0.0.1:54322/postgres') die('source status returned an unexpected local database endpoint');
  assertContainer(projectIds[0], sourceDir);
  supabase(sourceDir, ['db', 'reset', '--local', '--yes'], 'source migration application failed', 600000);

  let owner;
  let hrActor;
  const employee = 'a7000000-0000-4000-8000-000000000001';
  const sql = `
    insert into hr_private.account_invites(email,role,is_active) values
      ('backup-owner@example.invalid','owner',true),('backup-hr@example.invalid','hr',true);
    create role hr_cli_backup_probe nologin;
  `;
  assertContainer(projectIds[0], sourceDir);
  if (psql('postgres', `select (select count(*) from auth.users where lower(email) in ('backup-owner@example.invalid','backup-hr@example.invalid')) || ':' || (select count(*) from hr_private.account_invites where email in ('backup-owner@example.invalid','backup-hr@example.invalid'))`) !== '0:0') die('synthetic Auth/account allowlist is not pristine before fixture creation');
  psql('postgres', sql);
  assertContainer(projectIds[0], sourceDir);
  const sourceInfo = parseStatus(sourceStatus);
  const apiUrl = sourceInfo.API_URL;
  const serviceKey = sourceInfo.SERVICE_ROLE_KEY;
  if (apiUrl !== 'http://127.0.0.1:54321' || !serviceKey) die('source local Auth API endpoint/key unavailable');
  owner = await createSyntheticAuthUser(apiUrl, serviceKey, 'backup-owner@example.invalid');
  hrActor = await createSyntheticAuthUser(apiUrl, serviceKey, 'backup-hr@example.invalid');
  delete sourceInfo.SERVICE_ROLE_KEY;
  if (psql('postgres', `select count(*) from public.app_users where id in (${sqlLit(owner)},${sqlLit(hrActor)}) and is_active`) !== '2') die('Auth invitation triggers did not create active application accounts');
  let restoreSeed = (await readFile(join(root, 'database/tests/restore-rehearsal/seed.sql'), 'utf8'));
  restoreSeed = restoreSeed.replaceAll('76000000-0000-4000-8000-000000000001', owner).replaceAll('76000000-0000-4000-8000-000000000002', hrActor);
  assertContainer(projectIds[0], sourceDir);
  psql('postgres', restoreSeed);
  const ownerQ = sqlLit(owner), hrQ = sqlLit(hrActor), employeeQ = sqlLit(employee);
  const graphFingerprintSql = `select jsonb_build_object(
    'auth',(select jsonb_agg(to_jsonb(u) order by u.id) from auth.users u where u.id in (${ownerQ},${hrQ})),
    'identities',(select jsonb_agg(to_jsonb(i) order by i.id) from auth.identities i where i.user_id in (${ownerQ},${hrQ})),
    'invites',(select jsonb_agg(to_jsonb(i) order by i.email) from hr_private.account_invites i where i.email in ('backup-owner@example.invalid','backup-hr@example.invalid')),
    'accounts',(select jsonb_agg(to_jsonb(a) order by a.id) from public.app_users a where a.id in (${ownerQ},${hrQ})),
    'employees',(select jsonb_agg(to_jsonb(e) order by e.id) from public.employees e where e.id=${employeeQ}),
    'identity_documents',(select jsonb_agg(to_jsonb(i) order by i.id) from public.identity_documents i where i.employee_id=${employeeQ}),
    'bank_accounts',(select jsonb_agg(to_jsonb(b) order by b.id) from public.bank_accounts b where b.employee_id=${employeeQ}),
    'emergency_contacts',(select jsonb_agg(to_jsonb(e) order by e.id) from public.emergency_contacts e where e.employee_id=${employeeQ}),
    'leave_types',(select jsonb_agg(to_jsonb(t) order by t.id) from public.leave_types t where t.id='a7000000-0000-4000-8000-000000000002'),
    'policy',(select jsonb_agg(to_jsonb(p) order by p.id) from public.leave_policy_defaults p where p.leave_type_id='a7000000-0000-4000-8000-000000000002'),
    'entitlements',(select jsonb_agg(to_jsonb(e) order by e.id) from public.leave_entitlements e where e.employee_id=${employeeQ}),
    'holidays',(select jsonb_agg(to_jsonb(h) order by h.id) from public.holidays h where h.holiday_date between date '2096-01-01' and date '2096-01-31'),
    'leave_entries',(select jsonb_agg(to_jsonb(l) order by l.id) from public.leave_entries l where l.employee_id=${employeeQ}),
    'leave_days',(select jsonb_agg(to_jsonb(d) order by d.id) from public.leave_entry_days d where d.leave_entry_id in (select l.id from public.leave_entries l where l.employee_id=${employeeQ})),
    'request_ledger',(select jsonb_agg(to_jsonb(r) order by r.actor_id,r.request_key) from public.leave_entry_requests r where r.actor_id=${ownerQ}),
    'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from public.audit_events a where a.actor_id in (${ownerQ},${hrQ}) or a.record_id=${employeeQ}))::text`;
  const sourceFingerprint = psql('postgres', graphFingerprintSql);
  // Role OIDs differ across independent clusters; compare effective grants by
  // role name while retaining every privilege and grant-option entry.
  const catalogFingerprintSql = (await readFile(join(root, 'database/tests/restore-rehearsal/fingerprint.sql'), 'utf8'))
    .replace("grantor::text||':'||grantee::text", "pg_get_userbyid(grantor)||':'||case when grantee=0 then 'PUBLIC' else pg_get_userbyid(grantee) end")
    .replace("order by grantor,grantee,privilege_type,is_grantable", "order by pg_get_userbyid(grantor),case when grantee=0 then 'PUBLIC' else pg_get_userbyid(grantee) end,privilege_type,is_grantable");
  const sourceCatalogFingerprint = psql('postgres', catalogFingerprintSql);
  const shimBin = join(work, 'shim-bin'); await mkdir(shimBin, { mode: 0o700 });
  const shimPath = join(shimBin, 'supabase'); await strictSupabaseShim(shimPath, { sourceWorkdir: sourceDir, tempRoot: privateDir });
  const archiveDir = join(privateDir, 'out'); await mkdir(archiveDir, { mode: 0o700 });
  const backupEnv = cleanEnv({ PATH: `${shimBin}:${process.env.PATH}`, SUPABASE_PROJECT_REF: fakeRef, SUPABASE_DB_URL: `postgresql://postgres:synthetic-only@db.${fakeRef}.supabase.co:5432/postgres`, AGE_RECIPIENT: recipient, BACKUP_OUTPUT_DIR: archiveDir, TMPDIR: privateDir });
  run('bash', [join(root, 'database/scripts/backup/create-encrypted-backup.sh'), fakeRef], { env: backupEnv, timeout: 600000, failure: 'real CLI synthetic database dump/encryption failed' });
  const archiveName = (await (await import('node:fs/promises')).readdir(archiveDir)).find(n => n.endsWith('.tar.age'));
  if (!archiveName) die('encrypted archive was not created');
  const archive = join(archiveDir, archiveName);
  const manifest = `${archive}.manifest.json`;
  supabase(sourceDir, ['stop', '--no-backup', '--project-id', projectIds[0]], 'source Supabase stack cleanup failed');
  assertStopped(projectIds[0]); active.delete(sourceDir);
  active.add(targetDir);
  supabase(targetDir, ['start'], 'target Supabase stack failed to start');
  const targetContainer = assertContainer(projectIds[1], targetDir);
  const targetStatus = supabase(targetDir, ['status', '-o', 'env'], 'target status failed');
  const targetDbUrl = labelValue(targetStatus, 'DB_URL');
  if (targetDbUrl !== 'postgresql://postgres:postgres@127.0.0.1:54322/postgres') die('target status returned an unexpected local database endpoint');
  assertContainer(projectIds[1], targetDir);
  dedicateManagedBaseline(targetContainer);
  // The helper is exercised with its true loopback and exact-database-name guard.
  const restoreEnv = cleanEnv({ AGE_IDENTITY_FILE: keyFile, RESTORE_DB_URL: `postgresql://postgres:postgres@127.0.0.1:54322/${targetDb}`, TMPDIR: privateDir });
  assertContainer(projectIds[1], targetDir);
  run('bash', [join(root, 'database/scripts/backup/restore-local-encrypted-backup.sh'), archive, manifest, targetDb], { env: restoreEnv, timeout: 600000, failure: 'encrypted restore into dedicated initialized target database failed' });
  assertContainer(projectIds[1], targetDir);
  const restoredFingerprint = psql(targetDb, graphFingerprintSql);
  if (restoredFingerprint !== sourceFingerprint) die('restored synthetic Auth/HR graph differs from source');
  if (psql(targetDb, catalogFingerprintSql) !== sourceCatalogFingerprint) die('restored table checksums, effective ACLs, policies, constraints, triggers, or function definitions differ from source');
  const checks = psql(targetDb, `select (exists(select 1 from pg_roles where rolname='hr_cli_backup_probe'))::int || ':' || (select relrowsecurity::int from pg_class where oid='public.employees'::regclass) || ':' || ((select count(*) from pg_policies where schemaname='public' and tablename='employees')>=3)::int || ':' || (select exists(select 1 from pg_proc where oid='public.save_holiday(uuid,date,text,timestamp with time zone)'::regprocedure))::int || ':' || has_table_privilege('authenticated','public.employees','select')::int || ':' || has_table_privilege('anon','public.employees','select')::int || ':' || has_function_privilege('authenticated','public.save_holiday(uuid,date,text,timestamp with time zone)','execute')::int || ':' || has_function_privilege('anon','public.save_holiday(uuid,date,text,timestamp with time zone)','execute')::int || ':' || (exists(select 1 from pg_trigger where tgname='hr_authorized_account_created' and not tgisinternal and pg_get_triggerdef(oid) ilike '%hr_private.sync_authorized_account%'))::int || ':' || (exists(select 1 from pg_trigger where tgname='hr_authorized_account_changed' and not tgisinternal and pg_get_triggerdef(oid) ilike '%hr_private.sync_authorized_account%'))::int || ':' || (exists(select 1 from pg_constraint where conrelid='public.app_users'::regclass and confrelid='auth.users'::regclass and contype='f' and pg_get_constraintdef(oid) ilike '%FOREIGN KEY (id) REFERENCES auth.users(id)%'))::int`);
  if (checks !== '1:1:1:1:1:0:1:0:1:1:1') die('restored role, RLS, effective grants, RPC, Auth triggers, or FK verification failed');
  let verifySql = await readFile(join(root, 'database/tests/restore-rehearsal/verify.sql'), 'utf8');
  verifySql = verifySql.replaceAll('76000000-0000-4000-8000-000000000001', owner).replaceAll('76000000-0000-4000-8000-000000000002', hrActor);
  const verify = psql(targetDb, verifySql);
  if (!verify.includes('PASS: restored synthetic graph')) die('restored graph, balance, RLS, or RPC behavior verification failed');
  successMessage = 'Synthetic CLI backup rehearsal passed: CLI 2.119.0 local dump, real age encryption/restore, separate Supabase clusters, dedicated hr_restore_synthetic database, Auth-to-HR FK graph, custom role, RLS and authenticated RPC. No real data or remote project was used.\n';
}

async function cleanup() {
  let failed = false;
  for (const dir of [...active].reverse()) {
    const id = projectIds[dir === sourceDir ? 0 : 1];
    try {
      supabase(dir, ['stop', '--no-backup', '--project-id', id], 'local Supabase stack cleanup failed', 180000);
      assertStopped(id);
      active.delete(dir);
    } catch {
      failed = true;
      process.stderr.write(`failed to verify cleanup for isolated Supabase project ${id}; runner directory retained at ${work}\n`);
    }
  }
  if (work && identityCreated) {
    try { run('shred', ['-u', '--', join(work, 'private/age-identity.txt')], { failure: 'cannot remove ephemeral age identity' }); }
    catch { process.stderr.write('failed to remove ephemeral age identity from private runner storage\n'); failed = true; }
  }
  if (failed) { process.exitCode = 1; return; }
  if (work) {
    try { await rm(work, { recursive: true, force: true }); }
    catch { process.stderr.write(`failed to remove private rehearsal directory ${work}\n`); process.exitCode = 1; }
  }
  if (process.exitCode !== 1 && successMessage) process.stdout.write(successMessage);
}

main().catch(async error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}).finally(cleanup);
