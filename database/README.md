# HR database foundation

Applied on 2026-09-30 to Supabase HRM (kedohmbtpegupndldkex).

## Phase 2 status

Database structure and RLS have been applied and verified. Phase 2 is NOT complete: the Next.js app now uses Supabase Auth and protected database reads. Two owner emails are enrolled privately, but their Auth accounts must be activated by first-time password setup and email verification. Production Auth redirect and email delivery still need validation.

## Structure

12 public tables: app_users, employees, identity_documents, bank_accounts, emergency_contacts, leave_types, leave_policy_defaults, leave_entitlements, holidays, leave_entries, leave_entry_days, audit_events.

All tables have RLS enabled and explicit grants. Active owner and HR users share organization-wide employee data. app_users is an administrator-managed allowlist: users can read only their own active membership and cannot grant themselves access. No employee self-service or signup authorization is implemented.

Employee and policy tables permit authorized INSERT/UPDATE. DELETE is not granted; employment status and leave type activation retain history. Leave tables and audit_events are read-only to clients until phase 5 implements transactional validation and audit writing. There are no leave RPCs, automatic audit triggers, balance views or annual quota initialization yet. Changes to quotas below already-used days must be checked when phase 5 is implemented.

No company leave quotas, holidays, personal data or permanent test accounts were inserted. Dates use date and timestamps use timestamptz; application calendar logic must use Asia/Bangkok and Gregorian years. Saturday/Sunday exclusion remains the README policy for the future leave calculation.

## Verification

Rollback-only tests in tests/hr_foundation.sql passed: owner/HR shared read/write; disabled user and nonmember denied; anonymous access denied; forged user_metadata cannot authorize; membership escalation and direct leave writes denied; duplicate employee code, invalid 0.5 quota increment, override without reason rejected. Fixtures were rolled back. These simulate authenticated JWT database contexts; they do not verify browser login.

Security Advisor: no findings after restricting pre-existing public.rls_auto_enable execution. Performance Advisor reports unused indexes on a new database; they are retained for planned queries.

## Reproducibility

hr_foundation.sql preserves the applied SQL. Remote migration history contains hr_foundation_tables_and_rls and restrict_internal_rls_event_trigger_execution. The schema SQL is for a fresh database, not for rerunning against this initialized project.

## Remaining work

Validate Auth URLs for Vercel, owner activation, email delivery, real login/logout and password recovery. Server route authorization and database RLS are implemented and tested. Then continue phases 3–7.

## Invited accounts

hr_accounts.sql adds a private allowlist and Auth triggers. Only invited email addresses may register. The role is read from this administrator-controlled table; membership is created after email confirmation and disabled if the account email becomes unauthorized. Client access to invitation data is denied. Actual owner emails were inserted only in the live database, not in this repository. Test-only Auth rows are rolled back.
