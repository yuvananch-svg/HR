#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const guardedRunner = resolve(repoRoot, 'database/scripts/local-regression.mjs');
const sqlRoot = 'database/tests/phase5_concurrency/';
const lockNotice = 'Session A holds Phase 5 locks; start session B now.';
const actorNotice = 'PASS: session A saved entry';
const conflictNotice = 'PASS: session B was rejected with overlap_conflict';
const timeoutNoticeMs = 15_000;
const timeoutCommandMs = 30_000;
const timeoutOverlapMs = 4_500;
const overlapPollMs = 75;

function pendingMarkerPath() {
  const run = (process.env.GITHUB_RUN_ID ?? 'local').replace(/[^a-zA-Z0-9_-]/g, '_');
  const target = createHash('sha256').update(process.env.HR_TEST_DATABASE_URL ?? '').digest('hex').slice(0, 12);
  return resolve(tmpdir(), `hr-phase5-concurrency-${run}-${target}.pending`);
}

function markPending() {
  writeFileSync(pendingMarkerPath(), 'Phase 5 local concurrency fixture may need cleanup.\n', { mode: 0o600 });
}

function clearPending() {
  try { unlinkSync(pendingMarkerPath()); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function clipOutput(value) {
  return value.length > 6000 ? `${value.slice(0, 6000)}\n[output clipped]` : value;
}

function childOutput(child) {
  return `${child.stdout}\n${child.stderr}`;
}

function resultError(label, result) {
  const details = clipOutput(childOutput(result));
  return new Error(`${label} failed${result.exitCode === null ? ` (${result.signal ?? 'terminated'})` : ` with exit code ${result.exitCode}`}.${details.trim() ? `\n${details.trim()}` : ''}`);
}

function runnerSqlPath(relativeSql) {
  return relativeSql.includes('/') ? `database/tests/${relativeSql}` : `${sqlRoot}${relativeSql}`;
}

function startGuardedSql(relativeSql, activeChildren) {
  const child = spawn(process.execPath, [guardedRunner, 'sql', runnerSqlPath(relativeSql)], {
    cwd: repoRoot,
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { child, stdout: '', stderr: '', closed: false, exitCode: null, signal: null, waiters: new Set() };
  activeChildren.add(state);

  function consume(stream, value) {
    const next = stream === 'stdout' ? state.stdout + value : state.stderr + value;
    state[stream] = next.slice(-12_000);
    const output = childOutput(state);
    for (const waiter of state.waiters) {
      if (output.includes(waiter.phrase)) waiter.resolve(output);
    }
  }

  child.stdout.setEncoding('utf8').on('data', (value) => consume('stdout', value));
  child.stderr.setEncoding('utf8').on('data', (value) => consume('stderr', value));
  child.once('error', (error) => {
    state.spawnError = error;
  });
  state.result = new Promise((resolveResult) => {
    child.once('close', (exitCode, signal) => {
      state.closed = true;
      state.exitCode = exitCode;
      state.signal = signal;
      activeChildren.delete(state);
      for (const waiter of state.waiters) waiter.reject(new Error(`${relativeSql} process ended before the required database notice.`));
      resolveResult(state);
    });
  });
  state.waitFor = (phrase, timeoutMs) => {
    if (childOutput(state).includes(phrase)) return Promise.resolve(childOutput(state));
    if (state.closed) return Promise.reject(new Error(`${relativeSql} process ended before the required database notice.`));
    return new Promise((resolveNotice, rejectNotice) => {
      const waiter = {
        phrase,
        resolve(value) { clearTimeout(timer); state.waiters.delete(waiter); resolveNotice(value); },
        reject(error) { clearTimeout(timer); state.waiters.delete(waiter); rejectNotice(error); },
      };
      const timer = setTimeout(() => waiter.reject(new Error(`Timed out waiting for the Phase 5 lock notice from ${relativeSql}.`)), timeoutMs);
      state.waiters.add(waiter);
    });
  };
  return state;
}

async function waitForResult(state, label, timeoutMs = timeoutCommandMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded its ${timeoutMs} ms time limit.`)), timeoutMs);
  });
  try {
    const result = await Promise.race([state.result, timeout]);
    if (result.spawnError) throw new Error(`Could not start guarded local SQL runner for ${label}.`);
    if (result.exitCode !== 0) throw resultError(label, result);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function runSingleGuardedSql(relativeSql, { quiet = false, activeChildren = new Set() } = {}) {
  const child = startGuardedSql(relativeSql, activeChildren);
  let result;
  try {
    result = await waitForResult(child, relativeSql);
  } catch (error) {
    await terminateChild(child);
    throw error;
  }
  const output = childOutput(result);
  if (!quiet && output) process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
  return output;
}

async function terminateChild(state) {
  if (state.closed) return;
  try {
    if (process.platform === 'win32') state.child.kill('SIGTERM');
    else process.kill(-state.child.pid, 'SIGTERM');
  } catch { /* The process may have exited between the check and signal. */ }
  const forced = setTimeout(() => {
    try {
      if (process.platform === 'win32') state.child.kill('SIGKILL');
      else process.kill(-state.child.pid, 'SIGKILL');
    } catch { /* The process may already be gone. */ }
  }, 1_000);
  forced.unref?.();
  await Promise.race([state.result, new Promise((resolveWait) => setTimeout(resolveWait, 1_500))]);
  clearTimeout(forced);
}

function assertAAndB(a, b) {
  if (!childOutput(a).includes(actorNotice)) throw new Error('Session A did not report a successful saved entry.');
  if (!childOutput(b).includes(conflictNotice)) throw new Error('Session B did not report the expected overlap_conflict.');
}

export function parseLockStatus(output) {
  const marker = output.match(/STATUS:(\{[^\r\n]+\})/);
  if (!marker) return null;
  try {
    const status = JSON.parse(marker[1]);
    return Number.isInteger(status.a_pid) && status.a_pid > 0 && Number.isInteger(status.b_pid) && status.b_pid > 0 && status.a_pid !== status.b_pid
      && status.a_holds_advisory === true && status.b_waiting_advisory === true && status.a_blocks_b === true
      ? { aPid: status.a_pid, bPid: status.b_pid }
      : null;
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForObservedOverlap(readLockStatus, sessionA, sessionB) {
  const deadline = Date.now() + timeoutOverlapMs;
  while (Date.now() < deadline) {
    if (sessionA.closed || sessionB.closed) throw new Error('A concurrency session ended before PostgreSQL reported the lock wait.');
    const status = parseLockStatus(await readLockStatus());
    if (status) return status;
    await delay(overlapPollMs);
  }
  throw new Error('PostgreSQL did not report session B waiting on an advisory lock held by session A.');
}

export async function runPhase5Concurrency(deps = {}) {
  const active = new Set();
  const runSingle = deps.runSingle ?? ((name, options = {}) => runSingleGuardedSql(name, { ...options, activeChildren: active }));
  const startConcurrent = deps.startConcurrent ?? ((name) => startGuardedSql(name, active));
  const stopActive = deps.stopActive ?? (async () => Promise.all([...active].map(terminateChild)));
  const readLockStatus = deps.readLockStatus ?? (async () => runSingle('status.sql', { quiet: true }));
  const log = deps.log ?? ((message) => console.log(message));
  const setPending = deps.markPending ?? markPending;
  const clearPendingMarker = deps.clearPending ?? clearPending;
  let fixturePrepared = false;
  let failure;

  try {
    await runSingle('local-regression/verify-baseline.sql');
    setPending();
    fixturePrepared = true;
    await runSingle('setup.sql');

    const sessionA = startConcurrent('session_a.sql');
    active.add(sessionA);
    await sessionA.waitFor(lockNotice, timeoutNoticeMs);
    const sessionB = startConcurrent('session_b.sql');
    active.add(sessionB);
    const overlap = await waitForObservedOverlap(readLockStatus, sessionA, sessionB);
    log(`Observed PostgreSQL lock wait: A backend ${overlap.aPid} holds advisory lock; B backend ${overlap.bPid} waits on advisory lock; pg_blocking_pids(B) includes A.`);
    const [a, b] = await Promise.all([
      waitForResult(sessionA, 'Phase 5 session A'),
      waitForResult(sessionB, 'Phase 5 session B'),
    ]);
    assertAAndB(a, b);
    log('PASS: session A saved one entry; session B received overlap_conflict.');
    await runSingle('verify.sql');
  } catch (error) {
    failure = error;
  } finally {
    try {
      await stopActive();
    } catch (error) {
      failure = failure ? new AggregateError([failure, error], 'Concurrency run and process cleanup both failed.') : error;
    }
    if (fixturePrepared) {
      let baselineRestored = true;
      try {
        await runSingle('cleanup.sql');
      } catch (error) {
        baselineRestored = false;
        failure = failure ? new AggregateError([failure, error], 'Concurrency run and fixture cleanup both failed.') : error;
      }
      try {
        await runSingle('local-regression/verify-baseline.sql');
      } catch (error) {
        baselineRestored = false;
        failure = failure ? new AggregateError([failure, error], 'Concurrency run and baseline verification both failed.') : error;
      }
      if (baselineRestored) {
        try { clearPendingMarker(); }
        catch (error) { failure = failure ? new AggregateError([failure, error], 'Concurrency run succeeded but cleanup marker removal failed.') : error; }
      }
    }
  }

  if (failure) throw failure;
  log('Phase 5 concurrency race passed; baseline was preserved and scoped fixture cleanup verified.');
}

export async function cleanupIfPending() {
  if (!existsSync(pendingMarkerPath())) {
    console.log('No interrupted Phase 5 concurrency fixture cleanup is pending.');
    return;
  }
  try {
    await runSingleGuardedSql('cleanup.sql');
    await runSingleGuardedSql('local-regression/verify-baseline.sql');
    clearPending();
    console.log('Interrupted Phase 5 fixture cleanup and baseline verification passed.');
  } catch (error) {
    console.error(`phase5-concurrency cleanup fallback: ${error?.message ?? 'failed'}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'cleanup-fallback') cleanupIfPending();
  else runPhase5Concurrency().catch((error) => {
    console.error(`phase5-concurrency: ${error?.message ?? 'failed'}`);
    process.exitCode = 1;
  });
}
