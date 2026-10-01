import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLockStatus, runPhase5Concurrency } from './phase5-concurrency.mjs';

const passingStatus = 'STATUS:{"a_pid":41,"b_pid":42,"a_holds_advisory":true,"b_waiting_advisory":true,"a_blocks_b":true}';

test('accepts only distinct backends with A holding and B waiting on a blocking advisory lock', () => {
  assert.deepEqual(parseLockStatus(passingStatus), { aPid: 41, bPid: 42 });
  assert.equal(parseLockStatus('STATUS:{"a_pid":41,"b_pid":41,"a_holds_advisory":true,"b_waiting_advisory":true,"a_blocks_b":true}'), null);
  assert.equal(parseLockStatus('STATUS:{"a_pid":41,"b_pid":42,"a_holds_advisory":true,"b_waiting_advisory":false,"a_blocks_b":true}'), null);
  assert.equal(parseLockStatus('runner failed'), null);
});

function fakeSession(name, calls, output) {
  return {
    closed: false,
    waitFor: async (phrase) => {
      calls.push(`notice:${name}:${phrase}`);
      return phrase;
    },
    result: Promise.resolve({ exitCode: 0, stdout: output, stderr: '' }),
  };
}

test('starts B only after A notice, requires overlap evidence, and cleans to baseline', async () => {
  const calls = [];
  const runSingle = async (sql) => {
    calls.push(`sql:${sql}`);
    return 'PASS';
  };
  const startConcurrent = (name) => {
    calls.push(`start:${name}`);
    return name === 'session_a.sql'
      ? fakeSession('A', calls, 'PASS: session A saved entry fixture')
      : fakeSession('B', calls, 'PASS: session B was rejected with overlap_conflict');
  };
  await runPhase5Concurrency({
    runSingle,
    startConcurrent,
    readLockStatus: async () => { calls.push('status'); return passingStatus; },
    stopActive: async () => calls.push('stop'),
    markPending: () => calls.push('mark'),
    clearPending: () => calls.push('clear-marker'),
    log: () => {},
  });
  assert.deepEqual(calls, [
    'sql:local-regression/verify-baseline.sql',
    'mark',
    'sql:setup.sql',
    'start:session_a.sql',
    'notice:A:Session A holds Phase 5 locks; start session B now.',
    'start:session_b.sql',
    'status',
    'sql:verify.sql',
    'stop',
    'sql:cleanup.sql',
    'sql:local-regression/verify-baseline.sql',
    'clear-marker',
  ]);
});

test('stops concurrent processes before running scoped cleanup after a failed session', async () => {
  const calls = [];
  await assert.rejects(runPhase5Concurrency({
    runSingle: async (sql) => { calls.push(`sql:${sql}`); return 'PASS'; },
    startConcurrent: (name) => {
      calls.push(`start:${name}`);
      return name === 'session_a.sql'
        ? fakeSession('A', calls, 'PASS: session A saved entry fixture')
        : { ...fakeSession('B', calls, 'unexpected'), result: Promise.resolve({ exitCode: 1, stdout: '', stderr: 'expected test failure' }) };
    },
    readLockStatus: async () => passingStatus,
    stopActive: async () => calls.push('stop'),
    markPending: () => calls.push('mark'),
    clearPending: () => calls.push('clear-marker'),
    log: () => {},
  }), /Phase 5 session B failed/);
  assert.ok(calls.indexOf('stop') < calls.indexOf('sql:cleanup.sql'));
  assert.ok(calls.includes('sql:local-regression/verify-baseline.sql'));
});
