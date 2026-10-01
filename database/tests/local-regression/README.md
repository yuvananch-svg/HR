# Clean local database regression

This harness creates a clean schema and runs the rollback-only HR database checks without touching a linked or hosted project. It accepts only a loopback PostgreSQL URL for a database named exactly `hr_regression_test`, rejects URL query overrides, and requires the explicit `HR_LOCAL_TEST_CONFIRM=dedicated-local-regression-only` acknowledgement. Use a newly created, empty database reserved for this harness. The URL and password are never printed.

CI provisions an ephemeral PostgreSQL 17 service on the GitHub-hosted Linux runner, maps container port 5432 to `127.0.0.1:54322`, and runs the same `all` command against its dedicated `hr_regression_test` database. Those service credentials are synthetic workflow-only values; the service is discarded with the job. GitHub requires a Linux runner and a mapped host port when a runner-host job connects to a service container ([GitHub Actions documentation](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)).

The bootstrap reuses checked-in SQL in order: `database/hr_foundation.sql`, `database/hr_accounts.sql`, `database/phase3_employees.sql`, `database/phase4_leave_policy.sql`, `database/phase5_leave_entries.sql`, then `database/phase5_request_ledger_guards.sql`. The two initial baseline SQL sources are applied directly for this isolated regression; this does not add or infer remote migration identities. `database/hr_foundation.sql` now conditionally restricts `public.rls_auto_enable()` when that optional function exists, so a fresh PostgreSQL install does not fail on the absent function.

The bootstrap creates `anon`, `authenticated`, `auth.users`, and `auth.uid()` only when those objects are missing. On vanilla PostgreSQL these are minimal test stubs for the SQL policies and simulated JWT claims; they do not emulate the Supabase Auth service, JWT verification, PostgREST, or the hosted platform. Only a genuine local Supabase database supplies the actual Supabase Auth implementation. Two confirmed `.invalid` owner/HR users are retained in the dedicated test database so the Phase 6 read-model checks have seeded actors. All six regression scripts roll back their fixtures and mutations.

Create a fresh local database with the local PostgreSQL/Supabase administrator, then set the local URL and run:

```sh
export HR_LOCAL_TEST_CONFIRM=dedicated-local-regression-only
export HR_TEST_DATABASE_URL='postgresql://postgres:YOUR_LOCAL_PASSWORD@127.0.0.1:54322/hr_regression_test'
node database/scripts/local-regression.mjs all
```

`all` atomically bootstraps the schema and runs the six SQL regressions. For a database already bootstrapped by this harness, use `node database/scripts/local-regression.mjs regressions`. The runner refuses to bootstrap over public application objects or existing `auth.users` rows; start with a new empty database after any interrupted bootstrap.

After the six regressions, run `node database/scripts/phase5-concurrency.mjs` to execute the Phase 5 overlap check automatically. It uses the same guarded runner for setup, session A, session B, verification, and cleanup, and starts session B only after session A's lock notice. It also polls a read-only PostgreSQL status query until it observes two distinct backend PIDs, A holding an advisory lock, B waiting on an advisory lock, and `pg_blocking_pids(B)` including A. A passing notice without that database-side overlap evidence is a failed run. The harness checks the seeded local actor baseline before setup and after cleanup, and kills both child process groups before cleanup on errors. The CI workflow runs this after the six regressions and has a marker-gated fallback cleanup step for interrupted jobs.

Execution record: [workflow run 36828629726](https://github.com/yuvananch-svg/HR/actions/runs/36828629726) passed on PostgreSQL 17.11 for commit `819864cffa3bd72fa3229b2cea9c960893b0e74b`. The fresh bootstrap and six SQL regressions passed; the race observed A backend 105 holding an advisory lock and B backend 110 waiting with A in its blocking PIDs. A committed one entry, B received `overlap_conflict`, and verification found one charged date and one audit event. Eleven fixture counts were zero after cleanup, and both baseline assertions passed with only the two seeded actors/invites retained. This is isolated SQL evidence with Auth stubs; browser and hosted Supabase service acceptance remain separate.

## Independent-session concurrency checks

The following commands go through the same loopback, exact-database, acknowledgement, and URL checks. Run each `sql` command in its own terminal process. Do not execute these on a hosted project.

For the Phase 5 leave-save overlap, run setup once, start session A, then immediately start session B in a second terminal while A holds its test locks. Verify the result and always clean up:

```sh
node database/scripts/local-regression.mjs sql database/tests/phase5_concurrency/setup.sql
node database/scripts/local-regression.mjs sql database/tests/phase5_concurrency/session_a.sql
node database/scripts/local-regression.mjs sql database/tests/phase5_concurrency/session_b.sql
node database/scripts/local-regression.mjs sql database/tests/phase5_concurrency/verify.sql
node database/scripts/local-regression.mjs sql database/tests/phase5_concurrency/cleanup.sql
```

Expected overlap: A commits one entry; B reports `overlap_conflict`; verification finds one entry, charged day, and audit event; cleanup counts are zero. If B starts after A commits, its preview can fail as `quota_exceeded`; that is a sequential run and does not prove the race. The setup commits fixtures, so run cleanup after success or inspect the reserved fixture IDs before cleanup after interruption.

Phase 4 generation and revision races use the matching files under `database/tests/phase4_concurrency/`. Follow `database/tests/phase4_concurrency/README.md` for ordering and revision replacement. Its setup requires no active leave types and no 2098 policy/entitlement rows; it prints the expected generation count. Cleanup is required after setup.
