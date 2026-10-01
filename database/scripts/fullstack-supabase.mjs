#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const projectId = 'hr-ci-' + randomBytes(5).toString('hex');
const ownerEmail = `owner-${randomBytes(5).toString('hex')}@example.invalid`;
const hrEmail = `hr-${randomBytes(5).toString('hex')}@example.invalid`;
const disabledEmail = `disabled-${randomBytes(5).toString('hex')}@example.invalid`;
const signupControlEmail = `signup-control-${randomBytes(5).toString('hex')}@example.invalid`;
const outsiderEmail = `outsider-${randomBytes(5).toString('hex')}@example.invalid`;
const disabledSignupEmail = `disabled-signup-${randomBytes(5).toString('hex')}@example.invalid`;
const nonmemberEmail = `nonmember-${randomBytes(5).toString('hex')}@example.invalid`;
const forgedRoleEmail = `forged-${randomBytes(5).toString('hex')}@example.invalid`;
const ownerPassword = randomBytes(30).toString('base64url') + 'aA1!';
const hrPassword = randomBytes(30).toString('base64url') + 'bB2!';
const disabledPassword = randomBytes(30).toString('base64url') + 'cC3!';
const nonmemberPassword = randomBytes(30).toString('base64url') + 'dD4!';
const forgedRolePassword = randomBytes(30).toString('base64url') + 'eE5!';

const sourceMigrations = [
  ['20261001000100_hr_foundation.sql', 'database/hr_foundation.sql'],
  ['20261001000200_hr_accounts.sql', 'database/hr_accounts.sql'],
  ['20261001000300_phase3_employees.sql', 'database/phase3_employees.sql'],
  ['20261001000400_phase4_leave_policy.sql', 'database/phase4_leave_policy.sql'],
  ['20261001000500_phase5_leave_entries.sql', 'database/phase5_leave_entries.sql'],
  ['20261001000600_phase5_request_ledger_guards.sql', 'database/phase5_request_ledger_guards.sql'],
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    // CLI/auth output can contain generated keys or credentials. Never surface it.
    throw new Error(options.failure ?? `Local Supabase operation failed: ${command} ${args[0] ?? ''}`);
  }
  return result.stdout;
}

function localOnlyEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|SUPABASE_PROJECT_ID|SUPABASE_PROJECT_REF|SUPABASE_DB_URL|DATABASE_URL)$/i.test(name)));
}

function supabase(projectDir, args, failure) {
  const timeout = args[0] === 'start' ? 15 * 60_000 : args[0] === 'db' ? 5 * 60_000 : 120_000;
  return run('supabase', ['--workdir', projectDir, ...args], { failure, timeout, env: localOnlyEnvironment() });
}

function parseEnvOutput(output) {
  const parsed = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { throw new Error('Local Supabase status output was malformed'); }
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw new Error('Local Supabase status output was malformed');
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

export function guardLocalEndpoints(apiUrl, dbUrl) {
  let api;
  let db;
  try { api = new URL(apiUrl); db = new URL(dbUrl); } catch { throw new Error('Refusing malformed local Supabase target'); }
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.port !== '54321' || api.pathname !== '/' || api.username || api.password || api.search || api.hash) {
    throw new Error('Refusing non-local Supabase API target');
  }
  if (db.protocol !== 'postgresql:' || db.hostname !== '127.0.0.1' || db.port !== '54322' || db.pathname !== '/postgres' || db.username !== 'postgres' || db.search || db.hash) {
    throw new Error('Refusing non-local Supabase database target');
  }
}

function maskSecret(value) {
  if (process.env.GITHUB_ACTIONS === 'true' && value) process.stdout.write(`::add-mask::${value}\n`);
}

function writeGitHubEnv(values) {
  const githubEnv = process.env.GITHUB_ENV;
  if (!githubEnv) throw new Error('Expected a GitHub Actions environment file');
  for (const value of Object.values(values)) maskSecret(value);
  const body = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  return writeFile(githubEnv, body, { flag: 'a', mode: 0o600 });
}

async function prepareProject(projectDir) {
  await mkdir(projectDir, { recursive: true, mode: 0o700 });
  supabase(projectDir, ['init'], 'Supabase project initialization failed');
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
  await writeFile(join(projectDir, 'supabase/config.toml'), config, { mode: 0o600 });
  const migrationDir = join(projectDir, 'supabase/migrations');
  await mkdir(migrationDir, { recursive: true, mode: 0o700 });
  for (const [target, source] of sourceMigrations) {
    await copyFile(join(repositoryRoot, source), join(migrationDir, target));
  }
}

function parseStatus(projectDir) {
  const output = supabase(projectDir, ['status', '-o', 'env'], 'Supabase status lookup failed');
  const status = parseEnvOutput(output);
  guardLocalEndpoints(status.API_URL, status.DB_URL);
  if (!status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error('Supabase status omitted required local keys');
  for (const key of ['ANON_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET', 'DB_URL']) if (status[key]) maskSecret(status[key]);
  return status;
}

function psql(_dbUrl, sql) {
  const environment = Object.fromEntries(Object.entries(localOnlyEnvironment()).filter(([name]) => !name.startsWith('PG')));
  return run('psql', ['--no-psqlrc', '--no-password', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--host=127.0.0.1', '--port=54322', '--username=postgres', '--dbname=postgres', '--command', sql], {
    env: { ...environment, PGPASSWORD: 'postgres' },
    timeout: 30_000,
    failure: 'Synthetic local fixture preparation failed',
  });
}

function authUserCount(dbUrl, email) {
  const count = Number(psql(dbUrl, `select count(*) from auth.users where lower(email)=lower(${sqlLiteral(email)});`).trim());
  if (!Number.isInteger(count)) throw new Error('Local Auth membership assertion failed');
  return count;
}

function activeMembershipCount(dbUrl, email) {
  const count = Number(psql(dbUrl, `select count(*) from public.app_users u join auth.users a on a.id=u.id where lower(a.email)=lower(${sqlLiteral(email)}) and u.is_active and u.role='hr';`).trim());
  if (!Number.isInteger(count)) throw new Error('Local Auth membership assertion failed');
  return count;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function createAuthUser(apiUrl, serviceKey, email, password, confirmed, forgedOwnerMetadata = false) {
  const response = await localFetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: confirmed, user_metadata: { display_name: 'CI Synthetic User', ...(forgedOwnerMetadata ? { role: 'owner' } : {}) } }),
  });
  if (!response.ok) throw new Error('Local Auth user provisioning failed');
  const user = await parseAuthBody(response);
  if (!user.id || user.email !== email) throw new Error('Local Auth returned unexpected synthetic user identity');
  return user.id;
}

function localFetch(url, init) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
}

async function parseAuthBody(response) {
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (body?.access_token) maskSecret(body.access_token);
  if (body?.refresh_token) maskSecret(body.refresh_token);
  return body;
}

async function passwordToken(apiUrl, anonKey, email, password) {
  const response = await localFetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error('Synthetic Auth password sign-in failed');
  const result = await parseAuthBody(response);
  maskSecret(result.access_token);
  if (!result.access_token || result.user?.email !== email) throw new Error('Synthetic Auth token response was invalid');
  return result.access_token;
}

async function apiRequest(apiUrl, anonKey, token, path, { method = 'GET', body, profile } = {}) {
  const headers = { apikey: anonKey, authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (profile) headers['accept-profile'] = profile;
  const response = await localFetch(`${apiUrl}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  return { status: response.status, payload };
}

function requireApi(check, condition, label) {
  if (!condition) throw new Error(`Fullstack API acceptance failed: ${label}`);
  check.push(label);
}

async function verifyAuthAndApi(status) {
  const { API_URL: apiUrl, DB_URL: dbUrl, ANON_KEY: anonKey, SERVICE_ROLE_KEY: serviceKey } = status;
  // Keys are validated in-memory; endpoint guard runs before either SQL or API is used.
  guardLocalEndpoints(apiUrl, dbUrl);
  const seedSql = `
    insert into hr_private.account_invites(email, role, is_active) values
      (${sqlLiteral(ownerEmail)}, 'owner', true),
      (${sqlLiteral(hrEmail)}, 'hr', true),
      (${sqlLiteral(signupControlEmail)}, 'hr', true),
      (${sqlLiteral(disabledEmail)}, 'hr', true),
      (${sqlLiteral(nonmemberEmail)}, 'hr', true),
      (${sqlLiteral(forgedRoleEmail)}, 'hr', true),
      (${sqlLiteral(disabledSignupEmail)}, 'hr', false);
    insert into public.employees(id, employee_code, first_name, last_name, position, department, start_date)
      values ('a7100000-0000-4000-8000-000000000001', 'CI-001', 'Synthetic', 'Employee', 'Test', 'CI', date '2020-01-01');
    insert into public.leave_types(id, name, is_active, sort_order)
      values ('a7100000-0000-4000-8000-000000000002', 'CI Annual Leave', true, 1);
    insert into public.leave_policy_defaults(leave_type_id, year, quota_days)
      values ('a7100000-0000-4000-8000-000000000002', 2026, 10);
    insert into public.leave_entitlements(employee_id, leave_type_id, year, quota_days, source)
      values ('a7100000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000002', 2026, 10, 'policy');
  `;
  const nextYear = new Date().getUTCFullYear() + 1;
  psql(dbUrl, seedSql.replaceAll('2026', String(nextYear)));

  const ownerId = await createAuthUser(apiUrl, serviceKey, ownerEmail, ownerPassword, true);
  const hrId = await createAuthUser(apiUrl, serviceKey, hrEmail, hrPassword, true);
  const disabledId = await createAuthUser(apiUrl, serviceKey, disabledEmail, disabledPassword, true);
  await createAuthUser(apiUrl, serviceKey, nonmemberEmail, nonmemberPassword, true);
  await createAuthUser(apiUrl, serviceKey, forgedRoleEmail, forgedRolePassword, true, true);
  if (!ownerId || !hrId || !disabledId) throw new Error('Local Auth fixture identities were incomplete');
  psql(dbUrl, `update hr_private.account_invites set is_active=false where email=${sqlLiteral(disabledEmail)}; update public.app_users set is_active=false where id=(select id from auth.users where email=${sqlLiteral(disabledEmail)}); delete from public.app_users where id=(select id from auth.users where email=${sqlLiteral(nonmemberEmail)});`);

  // Signup is exercised through real GoTrue. The database allowlist trigger must reject an outsider.
  const outsiderPassword = randomBytes(30).toString('base64url') + 'dD4!';
  const checks = [];
  const allowedSignup = await localFetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: signupControlEmail, password: randomBytes(30).toString('base64url') + 'fF6!' }),
  });
  const allowedBody = await parseAuthBody(allowedSignup);
  requireApi(checks, allowedSignup.ok && Boolean(allowedBody?.user?.id ?? allowedBody?.id) && authUserCount(dbUrl, signupControlEmail) === 1 && activeMembershipCount(dbUrl, signupControlEmail) === 1, 'invited signup succeeds through managed Auth and allowlist trigger');

  const outsiderSignup = await localFetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: outsiderEmail, password: outsiderPassword }),
  });
  const outsiderBody = await parseAuthBody(outsiderSignup);
  const hasAllowlistTriggerFailure = /42501|account registration is restricted to invited users|database error (creating|saving) new user/i.test(`${outsiderBody?.code ?? ''} ${outsiderBody?.error ?? ''} ${outsiderBody?.msg ?? ''} ${outsiderBody?.message ?? ''} ${outsiderBody?.error_description ?? ''}`);
  requireApi(checks, outsiderSignup.status >= 400 && hasAllowlistTriggerFailure && authUserCount(dbUrl, outsiderEmail) === 0, 'uninvited signup rejected by allowlist trigger without auth.users row');
  const disabledSignupPassword = randomBytes(30).toString('base64url') + 'fF6!';
  const disabledSignup = await localFetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: disabledSignupEmail, password: disabledSignupPassword }),
  });
  const disabledBody = await parseAuthBody(disabledSignup);
  const disabledTriggerFailure = /42501|account registration is restricted to invited users|database error (creating|saving) new user/i.test(`${disabledBody?.code ?? ''} ${disabledBody?.error ?? ''} ${disabledBody?.msg ?? ''} ${disabledBody?.message ?? ''} ${disabledBody?.error_description ?? ''}`);
  requireApi(checks, disabledSignup.status >= 400 && disabledTriggerFailure && authUserCount(dbUrl, disabledSignupEmail) === 0, 'inactive invitation signup rejected by allowlist trigger without auth.users row');
  const outsiderSecretToken = await passwordToken(apiUrl, anonKey, outsiderEmail, outsiderPassword).catch(() => null);
  requireApi(checks, outsiderSecretToken === null, 'uninvited user cannot authenticate');

  const ownerToken = await passwordToken(apiUrl, anonKey, ownerEmail, ownerPassword);
  const hrToken = await passwordToken(apiUrl, anonKey, hrEmail, hrPassword);
  const disabledToken = await passwordToken(apiUrl, anonKey, disabledEmail, disabledPassword);
  const nonmemberToken = await passwordToken(apiUrl, anonKey, nonmemberEmail, nonmemberPassword).catch(() => null);
  const forgedRoleToken = await passwordToken(apiUrl, anonKey, forgedRoleEmail, forgedRolePassword);
  if (nonmemberToken === null) throw new Error('Synthetic confirmed nonmember could not authenticate');
  const anonMembers = await apiRequest(apiUrl, anonKey, anonKey, 'app_users?select=id');
  requireApi(checks, anonMembers.status >= 400 || (anonMembers.status < 300 && anonMembers.payload?.length === 0), 'anon cannot read memberships');
  const ownerMembership = await apiRequest(apiUrl, anonKey, ownerToken, 'app_users?select=role,is_active');
  requireApi(checks, ownerMembership.status < 300 && ownerMembership.payload?.length === 1 && ownerMembership.payload[0].role === 'owner' && ownerMembership.payload[0].is_active, 'invited owner is active');
  const hrMembership = await apiRequest(apiUrl, anonKey, hrToken, 'app_users?select=role,is_active');
  requireApi(checks, hrMembership.status < 300 && hrMembership.payload?.length === 1 && hrMembership.payload[0].role === 'hr' && hrMembership.payload[0].is_active, 'invited HR is active');
  const ownerEmployees = await apiRequest(apiUrl, anonKey, ownerToken, 'employees?select=employee_code');
  requireApi(checks, ownerEmployees.status < 300 && ownerEmployees.payload?.length === 1 && ownerEmployees.payload[0].employee_code === 'CI-001', 'owner reads authorized employee data');
  const hrEmployees = await apiRequest(apiUrl, anonKey, hrToken, 'employees?select=employee_code');
  requireApi(checks, hrEmployees.status < 300 && hrEmployees.payload?.length === 1, 'HR reads authorized employee data');
  const disabledMembership = await apiRequest(apiUrl, anonKey, disabledToken, 'app_users?select=id');
  requireApi(checks, disabledMembership.status < 300 && disabledMembership.payload?.length === 0, 'disabled invitation has no active app membership');
  const disabledEmployees = await apiRequest(apiUrl, anonKey, disabledToken, 'employees?select=id');
  requireApi(checks, disabledEmployees.status < 300 && disabledEmployees.payload?.length === 0, 'disabled user cannot read staff data');
  const disabledRpc = await apiRequest(apiUrl, anonKey, disabledToken, 'rpc/save_leave_type', { method: 'POST', body: { p_id: null, p_name: 'Denied Disabled Type', p_is_active: true, p_sort_order: 9, p_expected_updated_at: null } });
  requireApi(checks, disabledRpc.status >= 400, 'disabled user cannot invoke staff RPC');
  const nonmemberMembership = await apiRequest(apiUrl, anonKey, nonmemberToken, 'app_users?select=id');
  requireApi(checks, nonmemberMembership.status < 300 && nonmemberMembership.payload?.length === 0, 'confirmed nonmember has no application membership');
  const nonmemberEmployees = await apiRequest(apiUrl, anonKey, nonmemberToken, 'employees?select=id');
  requireApi(checks, nonmemberEmployees.status < 300 && nonmemberEmployees.payload?.length === 0, 'confirmed nonmember cannot read staff data');
  const nonmemberRpc = await apiRequest(apiUrl, anonKey, nonmemberToken, 'rpc/save_leave_type', { method: 'POST', body: { p_id: null, p_name: 'Denied Nonmember Type', p_is_active: true, p_sort_order: 7, p_expected_updated_at: null } });
  requireApi(checks, nonmemberRpc.status >= 400, 'confirmed nonmember cannot invoke staff RPC');
  const forgedMembership = await apiRequest(apiUrl, anonKey, forgedRoleToken, 'app_users?select=role');
  requireApi(checks, forgedMembership.status < 300 && forgedMembership.payload?.length === 1 && forgedMembership.payload[0].role === 'hr', 'forged metadata cannot elevate allowlist role');
  const invalidJwt = await apiRequest(apiUrl, anonKey, 'not-a-valid-jwt', 'employees?select=id');
  requireApi(checks, invalidJwt.status >= 400, 'invalid bearer token is denied');
  const anonRpc = await apiRequest(apiUrl, anonKey, anonKey, 'rpc/save_leave_type', { method: 'POST', body: { p_id: null, p_name: 'Denied Anon Type', p_is_active: true, p_sort_order: 8, p_expected_updated_at: null } });
  requireApi(checks, anonRpc.status >= 400, 'anon cannot invoke staff RPC');
  const membershipWrite = await apiRequest(apiUrl, anonKey, ownerToken, 'app_users', { method: 'POST', body: { id: ownerId, role: 'hr', is_active: true } });
  requireApi(checks, [401, 403].includes(membershipWrite.status) && membershipWrite.payload?.code === '42501', 'owner cannot mutate protected app membership');
  const directLeaveWrite = await apiRequest(apiUrl, anonKey, ownerToken, 'leave_entries', { method: 'POST', body: { employee_id: 'a7100000-0000-4000-8000-000000000001', leave_type_id: 'a7100000-0000-4000-8000-000000000002', start_date: `${new Date().getUTCFullYear() + 1}-11-02`, end_date: `${new Date().getUTCFullYear() + 1}-11-02`, day_unit: 'full', recorded_by: ownerId } });
  requireApi(checks, [401, 403].includes(directLeaveWrite.status) && directLeaveWrite.payload?.code === '42501', 'owner cannot bypass transactional leave RPC');

  const ownerSave = await apiRequest(apiUrl, anonKey, ownerToken, 'rpc/save_leave_type', { method: 'POST', body: { p_id: null, p_name: `Owner Allowed ${randomBytes(3).toString('hex')}`, p_is_active: false, p_sort_order: 10, p_expected_updated_at: null } });
  const savedType = Array.isArray(ownerSave.payload) && ownerSave.payload.length === 1 ? ownerSave.payload[0] : ownerSave.payload;
  requireApi(checks, ownerSave.status < 300 && typeof savedType?.id === 'string', 'owner can use authorized policy RPC');
  const hrSave = await apiRequest(apiUrl, anonKey, hrToken, 'rpc/save_holiday', { method: 'POST', body: { p_id: null, p_holiday_date: `${new Date().getUTCFullYear() + 1}-12-30`, p_name: 'Synthetic CI Holiday', p_expected_updated_at: null } });
  const savedHoliday = Array.isArray(hrSave.payload) && hrSave.payload.length === 1 ? hrSave.payload[0] : hrSave.payload;
  requireApi(checks, hrSave.status < 300 && typeof savedHoliday?.id === 'string', 'HR can use authorized holiday RPC');

  const privateInvite = await apiRequest(apiUrl, anonKey, ownerToken, 'account_invites?select=email', { profile: 'hr_private' });
  requireApi(checks, privateInvite.status >= 400, 'private invite schema is not exposed through PostgREST');

  // We never output or persist access tokens/service-role key. Only browser-safe fixture values
  // go to later workflow steps. CI evidence contains counts and assertion labels only.
  await writeGitHubEnv({
    LOCAL_SUPABASE_URL: apiUrl,
    LOCAL_SUPABASE_ANON_KEY: anonKey,
    LOCAL_TEST_OWNER_EMAIL: ownerEmail,
    LOCAL_TEST_OWNER_PASSWORD: ownerPassword,
  });
  const evidencePath = process.env.LOCAL_SUPABASE_EVIDENCE;
  if (evidencePath) {
    const expectedEvidence = join(resolve(process.env.RUNNER_TEMP ?? tmpdir()), 'hr-auth-api-evidence.json');
    if (resolve(evidencePath) !== expectedEvidence) throw new Error('Refusing evidence output outside the private temporary directory');
    await writeFile(evidencePath, JSON.stringify({ project: 'ephemeral-local', service: 'managed-auth+postgrest', syntheticAuthUsers: 6, syntheticAllowlistEntries: 7, checks }, null, 2) + '\n', { mode: 0o600 });
  }
  process.stdout.write(`PASS: ephemeral Supabase Auth/PostgREST acceptance (${checks.length} checks; local synthetic users only)\n`);
}

async function main() {
  const [command, suppliedDir] = process.argv.slice(2);
  if (command === 'guard-test') return;
  if (command === 'prepare') {
    const runnerTemp = resolve(process.env.RUNNER_TEMP ?? tmpdir());
    const projectDir = suppliedDir ? resolve(suppliedDir) : join(runnerTemp, 'hr-supabase-ci');
    if (projectDir !== join(runnerTemp, 'hr-supabase-ci')) throw new Error('Refusing project directory outside the designated temporary path');
    const marker = process.env.LOCAL_SUPABASE_PROJECT_DIR_FILE;
    if (!marker) throw new Error('Expected private local project path marker');
    if (resolve(marker) !== join(runnerTemp, 'hr-supabase-project-state.json')) throw new Error('Refusing project state outside the private temporary directory');
    let projectExists = false;
    try { await access(projectDir); projectExists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (projectExists) throw new Error('Refusing to overwrite an existing temporary Supabase project');
    try { await prepareProject(projectDir); }
    catch (error) { await rm(projectDir, { recursive: true, force: true }); throw error; }
    const state = { projectDir, projectId, started: false };
    await writeFile(marker, JSON.stringify(state), { mode: 0o600 });
    supabase(projectDir, ['start'], 'Ephemeral Supabase services failed to start');
    state.started = true;
    await writeFile(marker, JSON.stringify(state), { mode: 0o600 });
    parseStatus(projectDir);
    supabase(projectDir, ['db', 'reset', '--local', '--yes'], 'Ephemeral Supabase migrations failed');
    // Reset restarts Postgres; status check is repeated after migration to revalidate the target.
    const afterReset = parseStatus(projectDir);
    guardLocalEndpoints(afterReset.API_URL, afterReset.DB_URL);
    await verifyAuthAndApi(afterReset);
    return;
  }
  if (command === 'cleanup') {
    const marker = process.env.LOCAL_SUPABASE_PROJECT_DIR_FILE;
    if (!marker) return;
    let state;
    try { state = JSON.parse(await readFile(marker, 'utf8')); } catch { return; }
    const expectedProjectDir = join(resolve(process.env.RUNNER_TEMP ?? tmpdir()), 'hr-supabase-ci');
    if (state.projectDir !== expectedProjectDir || !/^hr-ci-[a-f0-9]{10}$/.test(state.projectId)) throw new Error('Refusing cleanup outside designated temporary Supabase project');
    // Stop must succeed before deleting the marker or claiming cleanup. This is
    // the same exact project ID persisted before startup, never --all.
    supabase(state.projectDir, ['stop', '--no-backup', '--project-id', state.projectId], state.started ? 'Local Supabase cleanup failed' : 'Partial Supabase startup cleanup failed');
    await rm(state.projectDir, { recursive: true, force: true });
    await rm(marker, { force: true });
    process.stdout.write('Ephemeral Supabase resources cleaned\n');
    return;
  }
  throw new Error('Usage: fullstack-supabase.mjs prepare|cleanup [temporary-project-dir]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? 'Fullstack local Supabase run failed'}\n`);
    process.exitCode = 1;
  });
}
