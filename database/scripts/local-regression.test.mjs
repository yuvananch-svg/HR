import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
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
