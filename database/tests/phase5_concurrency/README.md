# Phase 5 two-session overlap race

This operator-run check verifies that two saves based on a valid preview for the same employee/date cannot both succeed. It uses a dedicated synthetic account, employee, leave type, and the reserved test year 2097. It does not modify Phase 4 routines or the Phase 5 business rules.

Run only against a controlled Supabase database after all Phase 5 migrations, including `20260930103927_phase5_request_ledger_guards.sql`, are applied. Do not use this fixture year if another test or operator owns 2097 data. Use an administrator SQL connection for setup, verification, and cleanup; use two independent authenticated SQL sessions for the race.

With `TEST_DATABASE_URL` pointing to a controlled test database, the transactional regression can be run with `psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f database/tests/phase5_leave_entries.sql`. The documented `psql` procedure is for a controlled test database. The connector checks in the run record below used the HRM production project with synthetic fixtures and guarded cleanup.

1. Run `setup.sql` once as administrator. It refuses to continue if the reserved IDs, employee code, type name, or invitation email already exist.
2. In session A, run `session_a.sql`. It previews the date, takes locks in the RPC's order, and prints a notice when the five-second hold begins.
3. Start `session_b.sql` in session B as soon as that notice appears. It previews the same date and attempts to save. With an actual overlap, expect A to report one saved entry and B to report `overlap_conflict` after waiting for A to commit. If B is started after A has committed, its preview will instead fail first (for example, with `quota_exceeded`); that run is sequential and does not prove the race.
4. Run `verify.sql` as administrator. It asserts exactly one recorded entry, one charged day, and one audit event.
5. Run `cleanup.sql` as administrator. It validates fixture rows before deleting them and reports fixture counts across all affected tables; every count should be zero.

For each concurrent script, use an independent terminal/session with `psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f database/tests/phase5_concurrency/session_a.sql` or `session_b.sql`. Run setup, verify, and cleanup the same way with their respective paths.

The setup commits persistent fixtures so both sessions can observe them. Cleanup is therefore required after success or an interrupted run. Inspect the fixed fixture IDs before cleanup if either session stopped unexpectedly; the script refuses cleanup if it finds an unexpected leave row for its fixture employee.

Run record (2026-09-30): two attempts through the Supabase connector on HRM production created the fixture and session A saved. In both attempts, session B's preview ran after A committed and failed with `quota_exceeded`; the second attempt held A for 15 seconds and launched B after 100 ms, with the same result. Verification found one entry/day/audit, and both cleanups reported zero fixture rows. The connector appears to serialize SQL executions, so neither attempt proves concurrency. The race remains unverified until these scripts run through genuinely independent concurrent SQL sessions such as two `psql` processes.
