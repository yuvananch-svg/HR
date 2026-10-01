#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const confirmation = 'dedicated-local-regression-only';
const databaseName = 'hr_regression_test';
const args = process.argv.slice(2);
const command = args[0] ?? 'help';

function fail(message) {
  console.error(`local-regression: ${message}`);
  process.exit(2);
}

function connection() {
  if (process.env.HR_LOCAL_TEST_CONFIRM !== confirmation) {
    fail(`set HR_LOCAL_TEST_CONFIRM=${confirmation} after creating a dedicated local test database`);
  }
  const raw = process.env.HR_TEST_DATABASE_URL;
  if (!raw) fail('HR_TEST_DATABASE_URL is required (it is never printed)');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail('HR_TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    fail('database host must be localhost, 127.0.0.1, or ::1');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    fail('database URL scheme must be postgres:// or postgresql://');
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    fail('database URL query parameters and fragments are not accepted');
  }
  if (decodeURIComponent(parsed.pathname.slice(1)) !== databaseName) {
    fail(`database name must be exactly ${databaseName}`);
  }
  if (parsed.username === '') fail('database URL must include a local database user');
  const port = parsed.port === '' ? '5432' : parsed.port;
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    fail('database URL port must be a valid TCP port');
  }
  return {
    PGHOST: host,
    PGPORT: port,
    PGDATABASE: databaseName,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: 'disable',
    PGPASSFILE: '/dev/null',
    PGSERVICE: '',
    PGSERVICEFILE: '/dev/null',
    PGHOSTADDR: '',
    PGOPTIONS: '',
  };
}

const helpRequested = ['help', '--help', '-h'].includes(command);
const pgEnv = helpRequested ? {} : connection();

function psqlArgs(extra = []) {
  return ['--no-psqlrc', '--no-password', '--set=ON_ERROR_STOP=1', '--dbname', databaseName, ...extra];
}

function runPsql(extra, input) {
  const result = spawnSync('psql', psqlArgs(extra), {
    cwd: repoRoot,
    env: { ...process.env, ...pgEnv },
    input,
    encoding: 'utf8',
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
  });
  if (result.error?.code === 'ENOENT') fail('psql is required on PATH');
  if (result.error) fail(`could not run psql: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout?.trim() ?? '';
}

function query(sql) {
  const result = spawnSync('psql', psqlArgs(['--tuples-only', '--no-align', '--quiet', '--command', sql]), {
    cwd: repoRoot,
    env: { ...process.env, ...pgEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error?.code === 'ENOENT') fail('psql is required on PATH');
  if (result.error) fail(`could not run psql: ${result.error.message}`);
  if (result.status !== 0) {
    // psql stderr contains the server diagnostic only; never include a URL or password.
    process.stderr.write(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }
  return (result.stdout ?? '').trim();
}

function verifyTargetDatabase() {
  const target = query("select current_database() || '|' || current_setting('server_version')");
  const delimiter = target.indexOf('|');
  if (delimiter < 0 || target.slice(0, delimiter) !== databaseName) {
    fail(`connected database did not report the required name ${databaseName}`);
  }
  console.log(`Connected to ${databaseName} on PostgreSQL ${target.slice(delimiter + 1)}.`);
}

function requireFreshDatabase() {
  const dirty = query(`
    select exists(select 1 from pg_namespace where nspname='hr_private')
        or exists(
          select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')
        )
        or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
        or exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                  where n.nspname='public' and t.typtype<>'p' and t.typname not like '\\_%')`);
  if (dirty !== 'f') fail(`target database is not empty; use a newly created, dedicated ${databaseName} database`);
  if (query(`select to_regclass('auth.users') is not null`) === 't'
      && query('select exists(select 1 from auth.users)') !== 'f') {
    fail('target auth.users is not empty; use a newly created, dedicated test database');
  }
}

function requireBootstrappedDatabase() {
  const ready = query(`
    select to_regclass('public.app_users') is not null
       and to_regclass('public.leave_entries') is not null
       and to_regclass('public.leave_entry_requests') is not null
       and to_regprocedure('public.employee_search(text,text,text,text,integer,integer)') is not null
       and exists(select 1 from public.app_users where id='76000000-0000-4000-8000-000000000001')
       and exists(select 1 from public.app_users where id='76000000-0000-4000-8000-000000000002')`);
  if (ready !== 't') fail(`expected the complete Phase 3/4/5 bootstrap and local read actors in ${databaseName}`);
}

function sqlFile(path) {
  const absolute = resolve(repoRoot, path);
  const testsRoot = resolve(repoRoot, 'database/tests') + sep;
  if (!absolute.startsWith(testsRoot)) fail('SQL mode accepts only files under database/tests');
  const allowed = new Set([
    'phase4_concurrency/setup.sql', 'phase4_concurrency/generation_session_a.sql',
    'phase4_concurrency/generation_session_b.sql', 'phase4_concurrency/read_revision.sql',
    'phase4_concurrency/override_session_a.sql', 'phase4_concurrency/override_session_b.sql',
    'phase4_concurrency/cleanup.sql', 'phase5_concurrency/setup.sql',
    'phase5_concurrency/session_a.sql', 'phase5_concurrency/session_b.sql',
    'phase5_concurrency/verify.sql', 'phase5_concurrency/cleanup.sql',
  ]);
  const relative = absolute.slice(testsRoot.length).replaceAll('\\', '/');
  if (!allowed.has(relative)) fail('SQL mode is limited to the existing Phase 4/5 concurrency harness files');
  try {
    return { relative, contents: readFileSync(absolute, 'utf8') };
  } catch {
    fail(`SQL file not found: ${relative}`);
  }
}

function bootstrap() {
  verifyTargetDatabase();
  requireFreshDatabase();
  const files = [
    'database/tests/local-regression/auth-stub.sql',
    'database/hr_foundation.sql',
    'database/hr_accounts.sql',
    'database/phase3_employees.sql',
    'database/phase4_leave_policy.sql',
    'database/phase5_leave_entries.sql',
    'database/phase5_request_ledger_guards.sql',
    'database/tests/local-regression/seed-read-actors.sql',
  ];
  const sql = [
    'begin;',
    ...files.map((file) => `\\echo Applying ${file}\n\\i ${file}`),
    'commit;',
  ].join('\n');
  console.log(`Bootstrapping clean local ${databaseName} from checked-in SQL sources.`);
  runPsql([], sql);
  requireBootstrappedDatabase();
  console.log('Bootstrap complete. Synthetic local owner and HR read actors are installed.');
}

function regressions() {
  verifyTargetDatabase();
  requireBootstrappedDatabase();
  const files = [
    'database/tests/hr_foundation.sql',
    'database/tests/phase3_employees.sql',
    'database/tests/phase4_leave_policy.sql',
    'database/tests/phase5_leave_entries.sql',
    'database/tests/phase6_mutation_refresh.sql',
    'database/tests/phase6_read_model.sql',
  ];
  console.log(`Running six rollback-only SQL regressions on local ${databaseName}.`);
  for (const file of files) {
    console.log(`\n== ${file} ==`);
    runPsql(['--file', resolve(repoRoot, file)]);
  }
  console.log('\nAll six SQL regressions passed.');
}

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`Usage:
  HR_LOCAL_TEST_CONFIRM=${confirmation} HR_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/${databaseName} node database/scripts/local-regression.mjs all
  node database/scripts/local-regression.mjs bootstrap
  node database/scripts/local-regression.mjs regressions
  node database/scripts/local-regression.mjs sql database/tests/phase5_concurrency/session_a.sql

Every command requires the local-only confirmation and loopback database URL.
The target must be a dedicated, empty database named ${databaseName}.`);
} else if (command === 'bootstrap') {
  bootstrap();
} else if (command === 'regressions') {
  regressions();
} else if (command === 'all') {
  bootstrap();
  regressions();
} else if (command === 'sql') {
  const file = sqlFile(args[1] ?? '');
  verifyTargetDatabase();
  requireBootstrappedDatabase();
  console.log(`Running ${file.relative} on local ${databaseName}.`);
  runPsql(['--file', resolve(repoRoot, 'database/tests', file.relative)]);
} else {
  fail(`unknown command ${command}; use --help`);
}
