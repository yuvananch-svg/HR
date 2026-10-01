# HR database foundation

Applied on 2026-09-30 to Supabase HRM (kedohmbtpegupndldkex).

## Phase 2 status

Phase 2 is complete by user acceptance on 2026-09-30. Database structure, RLS, Supabase Auth integration and production redirect URLs are in place. The first owner has a verified active owner membership; the user reports successful login, logout and password recovery on the production app. Opening an additional account (including the second owner) has not been tested. HR account activation and delivery to recipients outside the Supabase organization team remain follow-ups; custom SMTP is still needed for that delivery path. These follow-ups do not block phase 3 under the user's instruction.

## Structure

12 public tables: app_users, employees, identity_documents, bank_accounts, emergency_contacts, leave_types, leave_policy_defaults, leave_entitlements, holidays, leave_entries, leave_entry_days, audit_events.

All tables have RLS enabled and explicit grants. Active owner and HR users share organization-wide employee data. app_users is an administrator-managed allowlist: users can read only their own active membership and cannot grant themselves access. There is no employee self-service. Invited owner/HR signup authorization is implemented by the private allowlist and Auth triggers.

Employee registry uses RLS-protected table writes and scoped RPCs. Phase 4 leave policy tables are read-only to direct client DML and writable through authenticated, active owner/HR RPCs with row revisions and server-side validation. Policy generation locks the selected year and each employee/type/year entitlement; overrides and resets use the same year-then-entitlement lock order and cannot go below used days. Holiday edits preserve recorded leave-entry days. Leave tables and audit_events remain read-only to clients until phase 5 implements transactional leave mutations and audit writing. Phase 5 must acquire the selected policy-year shared lock, then the employee/type/year entitlement lock, and must not write policy or entitlement tables directly.

No company leave quotas, holidays, personal data or permanent test accounts were inserted. Dates use date and timestamps use timestamptz; application calendar logic must use Asia/Bangkok and Gregorian years. Saturday/Sunday exclusion remains the README policy for the future leave calculation.

## Verification

Rollback-only tests in tests/hr_foundation.sql passed: owner/HR shared read/write; disabled user and nonmember denied; anonymous access denied; forged user_metadata cannot authorize; membership escalation and direct leave writes denied; duplicate employee code, invalid 0.5 quota increment, override without reason rejected. Fixtures were rolled back. These simulate authenticated JWT database contexts; they do not verify browser login.

Security Advisor: no findings after restricting pre-existing public.rls_auto_enable execution. Performance Advisor reports unused indexes on a new database; they are retained for planned queries.

## Reproducibility

hr_foundation.sql preserves the applied SQL. Remote migration history contains hr_foundation_tables_and_rls, restrict_internal_rls_event_trigger_execution, and the phase4 leave-policy migration. The phase4 rollback regression and two-session concurrency check passed against the initialized project on 2026-09-30: concurrent generation returned 0 and 2, concurrent overrides produced one save and one `P0001 revision_conflict`, and scoped cleanup left zero fixture rows while preserving baseline data. `tests/phase4_concurrency/` documents the operator-run check; setup preserves existing employees but requires no other active leave types and no existing 2098 policy/entitlement rows. The schema SQL is for a fresh database, not for rerunning against this initialized project.

## Remaining work

Phase 5 verification scripts are in `tests/phase5_leave_entries.sql` (transactional regression; all fixture changes roll back) and `tests/phase5_concurrency/` (persistent setup, two independent sessions, verification, and scoped cleanup). The transactional regression ran through the Supabase connector and passed; the transaction rolled back, and post-run checks found no 2096/2097 fixture entitlements or leave entries. The concurrency harness setup, session A, verification, and cleanup ran twice; the connector serialized SQL executions, so B's preview returned `quota_exceeded` after A committed both times. Cleanup reported zero fixture rows. This does not prove a concurrent race. Read `tests/phase5_concurrency/README.md` for run records and the required independent-session procedure. The concurrent race still needs a genuinely overlapping run.

Phase 4 is complete on 2026-09-30: database integration, two-session concurrency checks, desktop browser QA, and mobile QA using a 375×900 CSS iframe viewport passed. Final guarded cleanup removed all persistent QA fixtures while preserving the baseline employee; final counts are employees 1, leave_types 0, policy defaults 0, entitlements 0, holidays 0, and leave_entries 0. Proceed with phase 5 leave-entry mutations. Follow up separately on additional account activation, a real HR account when supplied, and SMTP delivery for recipients outside the Supabase team.

## Invited accounts

hr_accounts.sql adds a private allowlist and Auth triggers. Only invited email addresses may register. The role is read from this administrator-controlled table; membership is created after email confirmation and disabled if the account email becomes unauthorized. Client access to invitation data is denied. Actual owner emails were inserted only in the live database, not in this repository. Test-only Auth rows are rolled back.

## Phase 7 clean local regression harness

`tests/local-regression/README.md` documents the guarded clean-database bootstrap and six rollback-only regressions. `scripts/local-regression.mjs` only accepts `localhost`, `127.0.0.1`, or `::1`, requires the database name `hr_regression_test` and an explicit dedicated-local-test acknowledgement, rejects URL query/fragment overrides, and refuses a dirty public schema or populated `auth.users`. The SQL source sequence is foundation, account allowlist, phase 3, phase 4, phase 5, and the phase 5 request-ledger guard. It does not create or alter Supabase migration history. The absent `public.rls_auto_enable()` revoke is now conditional, preserving its restriction where the function exists while permitting clean local bootstrap where it does not.

This checkout contains three Phase 4/5 migration files; the previously recorded remote history contains eight entries. The clean bootstrap intentionally reuses the checked-in baseline SQL sources and does not guess missing migration names or timestamps. On vanilla PostgreSQL, local-only stubs provide `anon`, `authenticated`, `auth.users`, and `auth.uid()` for SQL policy tests; this is not a full Supabase Auth/PostgREST integration. Two synthetic confirmed `.invalid` actors persist only in the dedicated test database for the Phase 6 read regression.

Execution record for 2026-10-01: the fresh-schema bootstrap and all six rollback regressions passed on the isolated PostgreSQL 17 CI service in [workflow run 36827170647](https://github.com/yuvananch-svg/HR/actions/runs/36827170647) for commit `092cfcd37ad1d54db42c6dacec69e5a32c156045`. PostgreSQL 16 binaries were also present in the scratch environment, but `initdb` refused to run as root and switching to an unprivileged account failed because the sandbox denies `setgroups`/`setuid`; no local SQL run was attempted. The independent Phase 5 concurrency orchestrator now joins the CI job after those six regressions; its hosted race result is pending. `node --check` and the local target-guard tests passed for the runner before the concurrency orchestrator was added.
