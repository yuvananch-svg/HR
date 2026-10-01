# HR operations and handover

Prepared 2026-10-01. This is an operator procedure, not evidence that a release, backup, restore, alert delivery, or HR acceptance has passed. Phase 7 acceptance is tracked separately in `phase7-acceptance.md`.

## Responsibilities and decisions

The owner must name the application/database operator and an incident contact/channel before handover. Confirm actual leave types, quotas, weekends/holidays, year rollover, permitted users, required personal fields, correction/deletion authority, and retention. No default retention period is implied. Additional-account and HR browser acceptance remain deferred. Custom SMTP sender, provider and budget remain decisions; do not create recipients or purchase services from this guide.

## Daily owner/HR workflow

Sign in at the approved application URL. An active invited owner/HR membership is required; authentication alone does not grant access. Register a small number of employees and check unique employee codes, employment dates/status and optional personal details before expanding imports. Configure leave types, the year's standard quotas and holidays, then generate entitlements. Review per-person balances before overriding; give an audit reason. Preview dates before saving leave; review excluded days, each affected year's balance, and full/morning/afternoon units. After save, compare the entry, employee history, leave list and dashboard. Refresh on revision conflicts and review a new preview when requested. Correct a recorded entry with a reason or cancel it with a reason; cancellation is retained in history. Do not bypass UI validation with direct database writes.

Log out on shared devices. For password recovery, use the approved URL and recipient; record receipt and successful recovery without recording tokens, passwords or email contents. Do not count a SQL JWT simulation as browser login/recovery evidence. Delivery outside the Supabase organization team requires verified SMTP configuration and a deliberate recipient test.

## Release and rollback

1. Record candidate commit, deployment URL, database schema compatibility and unresolved acceptance gates. Review the diff for secrets and personal data. Confirm production environment variables exist before publishing removal of any embedded fallback.
2. Run `npm ci`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` using an explicit isolated configuration. Run the local database bootstrap/regression procedure and independent-session concurrency checks when the local runtime is available. A passing frontend build does not prove database compatibility.
3. Rehearse the candidate and previous web version against the isolated database. Prefer additive schema changes that retain older RPC contracts. Record smoke checks and the actual rollback result. An unperformed rehearsal remains an open gate.
4. Before any production migration, review its target, SQL, expected locks, backup/recovery position and compatibility with the current and previous web versions. Apply only approved migrations; never replay the fresh bootstrap against production. Do not repair remote migration history to match repository timestamps without a reviewed reconciliation.
5. Deploy the reviewed commit. Confirm deployment reports that commit, then smoke-test sign-in, access denial, workspace loading and the read-only baseline. Any synthetic mutation smoke test needs an isolated target or an explicitly authorized production fixture/cleanup scope.
6. If the web fails and schema remains compatible, redeploy the recorded previous web commit and repeat smoke checks. If schema is incompatible, stop mutations and follow the reviewed database recovery plan. Vercel rollback does not undo SQL, Auth changes or data writes. Do not run schema rollback or restore over production on this guide's authority.

## Monitoring and incidents

Use the existing deployment/provider dashboards initially; no paid integration or notification subscription is assumed. Observe deployment health, HTTP failure rates, authentication errors, denied-access anomalies and database availability. Record timestamp, deployment commit, affected route class, operation class and sanitized error code. Do not log employee names, identifiers, bank/identity details, leave reasons, full request payloads, cookies, tokens or SQL result dumps. Client-facing errors should stay generic or use the reviewed business-error mapping.

On incident: the designated operator confirms impact and current commit, disables further risky administrative operations operationally, preserves sanitized diagnostic evidence, identifies whether the fault is web/config/Auth/database, and chooses a compatible web rollback or reviewed database recovery. The contact/channel, response target and monitoring cadence require owner selection. No alerts have been connected or delivered by writing this guide.

## Backup and separate-target recovery

The HRM organization was confirmed on the Free plan on 2026-10-01. Do not assume automatic daily backup availability. Supabase recommends regular logical exports and off-site backups for Free projects. Database backups exclude Storage object bytes; custom role passwords and project configuration also need separate treatment. See [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

Before an actual production export, choose an encrypted destination, access owner, frequency, retention, deletion method, key custody, recovery point objective (acceptable data loss) and recovery time objective. These choices and usable credentials are pending. No real-data dump belongs in this public repository, CI artifacts, ordinary logs or screenshots.

After those decisions, the operator should inspect the installed Supabase CLI `--help` and current [backup/restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), then generate separate schema, role and data exports into the approved encrypted destination. Record tool versions, export time, hashes and decryption verification without exposing credentials. Inventory Auth users/settings, allowlist/memberships, redirect URLs, SMTP, keys/secret custody, Storage buckets/policies and object bytes, and deployment variables separately; verify which are included by the chosen export procedure. Never promise that public-schema exports alone restore authentication or project services.

Restore only to a dedicated isolated target after checking its hostname/project reference and proving it contains no production data. Reapply configuration under explicit authorization, verify row counts, foreign keys, RLS/grants/RPCs, membership denials, leave day totals and balances, and run mutation/read regression on synthetic fixtures. Record elapsed time against the selected recovery objectives and every manual gap. Keep application traffic away from the recovery target until review. A synthetic bootstrap or backup drill does not satisfy the actual production backup-and-restore acceptance gate.

## Security follow-up

The 2026-10-01 advisor review reported leaked-password protection disabled. The operator should review [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), confirm feature availability and implications, and obtain the owner's decision before changing Auth configuration. No credential, role, session policy or Auth setting was changed by this review.
