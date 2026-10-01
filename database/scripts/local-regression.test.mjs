import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runner = resolve(root, 'database/scripts/local-regression.mjs');
const validUrl = 'postgresql://local_user:local_password@127.0.0.1:54322/hr_regression_test';

function run(extraEnv = {}, command = 'all') {
  return spawnSync(process.execPath, [runner, command], {
    cwd: root,
    env: { ...process.env, HR_LOCAL_TEST_CONFIRM: undefined, HR_TEST_DATABASE_URL: undefined, ...extraEnv },
    encoding: 'utf8',
    timeout: 5000,
  });
}

test('help works without a database URL or confirmation', () => {
  const result = run({}, '--help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dedicated, empty database/i);
});

test('remote host is rejected before psql starts', () => {
  const secret = 'DO_NOT_ECHO_REMOTE_PASSWORD';
  const result = run({
    HR_LOCAL_TEST_CONFIRM: 'dedicated-local-regression-only',
    HR_TEST_DATABASE_URL: `postgresql://local_user:${secret}@db.example.com/hr_regression_test`,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /host must be localhost/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
});

test('wrong database name is rejected before psql starts', () => {
  const result = run({
    HR_LOCAL_TEST_CONFIRM: 'dedicated-local-regression-only',
    HR_TEST_DATABASE_URL: 'postgresql://local_user:local_password@127.0.0.1:54322/production',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /database name must be exactly hr_regression_test/);
});

test('missing dedicated-local confirmation is rejected before psql starts', () => {
  const result = run({ HR_TEST_DATABASE_URL: validUrl });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /HR_LOCAL_TEST_CONFIRM=/);
});

test('URL query overrides are rejected before psql starts', () => {
  const result = run({
    HR_LOCAL_TEST_CONFIRM: 'dedicated-local-regression-only',
    HR_TEST_DATABASE_URL: `${validUrl}?host=db.example.com`,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /query parameters and fragments are not accepted/);
});

test('psql inherits only the validated local connection settings', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hr-local-regression-'));
  try {
    const bin = join(temp, 'bin');
    const capture = join(temp, 'psql-env.json');
    mkdirSync(bin);
    const stub = join(bin, 'psql');
    writeFileSync(stub, `#!/usr/bin/env node
const fs = require('node:fs');
const envFile = process.env.PSQL_STUB_CAPTURE;
if (envFile && !fs.existsSync(envFile)) {
  const values = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^PG/i.test(key)));
  fs.writeFileSync(envFile, JSON.stringify(values));
}
const i = process.argv.indexOf('--command');
if (i >= 0) {
  const sql = process.argv[i + 1];
  if (sql.includes('current_database()')) process.stdout.write('hr_regression_test|17.0\\n');
  else if (sql.includes('current_setting') || sql.includes('pg_namespace')) process.stdout.write('f\\n');
  else if (sql.includes('to_regclass') && sql.includes('public.app_users')) process.stdout.write('t\\n');
  else if (sql.includes('to_regclass')) process.stdout.write('f\\n');
  else if (sql.includes('public.app_users')) process.stdout.write('t\\n');
  process.exit(0);
}
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
`);
    chmodSync(stub, 0o755);
    const result = spawnSync(process.execPath, [runner, 'all'], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        PSQL_STUB_CAPTURE: capture,
        HR_LOCAL_TEST_CONFIRM: 'dedicated-local-regression-only',
        HR_TEST_DATABASE_URL: validUrl,
        PGSERVICE: 'production',
        PGSERVICEFILE: '/tmp/untrusted-service-file',
        PGHOST: 'database.production.example',
        PGHOSTADDR: '203.0.113.9',
        PGOPTIONS: '-c application_name=unexpected',
        PGTARGETSESSIONATTRS: 'read-write',
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /local_password/);
    const env = JSON.parse(readFileSync(capture, 'utf8'));
    assert.deepEqual(env, {
      PGHOST: '127.0.0.1',
      PGPORT: '54322',
      PGDATABASE: 'hr_regression_test',
      PGUSER: 'local_user',
      PGPASSWORD: 'local_password',
      PGSSLMODE: 'disable',
      PGPASSFILE: '/dev/null',
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
