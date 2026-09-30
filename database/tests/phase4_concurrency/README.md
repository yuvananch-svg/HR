# Phase 4 two-session concurrency check

Run against a controlled project while no other process is changing 2098 policy/entitlement rows, using an administrator connection for setup/cleanup and two independent SQL sessions for each race. The fixed fixture UUIDs below are reserved for this script. Setup refuses ID/code/name collisions, other active leave types, and any existing 2098 policies or entitlements. Generation applies to every active employee; the setup prints the expected count. Cleanup scopes generated entitlements and policy defaults to the fixture leave type. Do not run this test if another operator may use 2098 during the test.

1. Run `setup.sql` once as database administrator and keep the transaction committed.
2. Start `generation_session_a.sql` in one authenticated session. As soon as its final result appears, start `generation_session_b.sql` in another session while A is in its two-second sleep. Session A holds the year lock during that interval. Expect A to return the `expected_total_generation_count` printed by setup and B to return `0`; exactly that many entitlements should exist for 2098.
3. Run `read_revision.sql` as administrator and paste the returned revision into both override scripts in place of `REPLACE_WITH_REVISION`.
4. Start `override_session_a.sql`; as soon as its final result appears, start `override_session_b.sql` while A is in its two-second sleep. Session A holds the entitlement lock during that interval. Expect A to save successfully and B to receive `revision_conflict` (`P0001`). The entitlement must end with quota 2.0 and reason `P4 concurrency session A`.
5. Run `cleanup.sql` as database administrator and confirm it reports no fixture rows remain.

The scripts do not run automatically and make no remote changes unless an operator executes them. Do not include the intentional sleep in any application RPC; it exists only to make the test overlap observable.
