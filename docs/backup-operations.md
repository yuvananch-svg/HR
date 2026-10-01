# Encrypted database backup operations

This is a prepared operator workflow for an encrypted logical backup of the Supabase Postgres database. It has not been run against production or proven through a live CLI/Docker export/restore rehearsal. The owner already has a private Google Drive backup folder. Production execution remains for an operator with the Supabase credential and age key custody. Do not treat this preparation as evidence of a completed backup or as meeting the 24-hour RPO until an operator runs it and verifies the uploaded artifact.

The chosen operating targets are one daily backup, 30-day retention, RPO 24 hours, and RTO 4 hours. A responsible operator must own the schedule and alerting. No cron, CI job, cloud automation, or paid service has been enabled by this preparation.

## Scope and known limits

The export is based on Supabase CLI 2.119.0's tagged source (`3cb948c5a70d31fbcb0fd1dcc616ee196a125cd0`): `roles.sql` (`--role-only`), `schema.sql` (default), and `data.sql` (`--data-only --use-copy`, excluding `storage.buckets_vectors` and `storage.vector_indexes`). That version excludes managed schemas including `auth` and `storage` from the schema dump; its data dump does include Auth and Storage table rows, except the CLI-managed migration tables and extension/managed exclusions in its implementation. The app's `auth.users` data is required by `public.app_users` foreign keys. The script separately captures `supabase_migrations` schema and history, as Supabase's guide directs.

The regular schema dump excludes `auth` customizations. This repo installs `hr_private.sync_authorized_account()` and two triggers on `auth.users` from `database/hr_accounts.sql`; the archive therefore contains an explicit trigger-recreation component and records the source SQL hash. Validate that component against the current reviewed SQL before each release of this workflow. A complete project recovery still needs the Supabase-managed baseline initialized on the local restore target, plus Auth settings/API keys, Edge Functions, Realtime configuration/publications, extension/database settings, secrets, and Storage object bytes. Storage metadata is distinct from object data. Review Vault/column encryption, webhooks, custom LOGIN role passwords, and other managed-schema customizations before declaring recovery complete.

Supabase documents the manual restore sequence as roles, schema, then data, using `psql --single-transaction --variable ON_ERROR_STOP=1` and `SET session_replication_role = replica` before data. Restore steps are deliberately not automated against any remote project here. The restore helper accepts only an exact dedicated database name beginning `hr_restore_` and a loopback connection URL, requires an initialized Supabase `auth.users` skeleton with zero users and empty app schemas/history, and verifies encrypted file hash, manifest, archive member names/types, and the Auth customization SQL hash before extraction. Never pass a production or hosted connection URL. The repository does not yet provide a fully isolated PG17.6 Supabase restore fixture, so operator acceptance requires an actual local restore rehearsal against a separately initialized local Supabase stack.

## Operator prerequisites

Use a trusted, encrypted workstation or host with Supabase CLI exactly 2.119.0, Docker (required by the CLI's containerized `pg_dump` workflow), age, Python 3, coreutils, tar, and PostgreSQL 17 `psql`. This project is known to use PostgreSQL 17.6; the CLI 2.119.0 source defaults remote dump major to 17. Check `supabase db dump --help` before operation, and review the source pin before changing it. The export script records CLI/age versions in a non-sensitive manifest. Source review confirms the passwordless `--db-url` path can use `PGPASSWORD` environment fallback; the script supplies this env var, never a password-bearing URL or password argument. It also clears unrelated libpq environment overrides before child commands. Its Python URL parser rejects query/fragment overrides and verifies either direct `db.<expected-ref>.supabase.co` host or supported session-pooler host plus `postgres.<expected-ref>` user.

Keep the age private identity offline or in an operator-controlled secret store. Put only its public recipient in `AGE_RECIPIENT`. Do not upload or commit the private identity, database URL, plaintext SQL/archive, or passphrase. Inject the connection string into `SUPABASE_DB_URL` from a protected prompt/secret manager; do not put it in shell history, argv, CI, logs, or chat. The script parses and removes that URL before launching children, then exports decoded password through `PGPASSWORD` only. Choose and independently check the expected 20-character production project reference. The script requires it both as an argument and in `SUPABASE_PROJECT_REF` and confirms it against the database host/user.

## First manual run

From the repository root, ensure the destination is a private local directory with adequate free space. Have Docker running and export the three protected environment inputs (`SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`, `AGE_RECIPIENT`) using the operator's secure method. Then run:

```sh
chmod 700 database/scripts/backup/create-encrypted-backup.sh
database/scripts/backup/create-encrypted-backup.sh "$SUPABASE_PROJECT_REF"
```

The script uses a mode-700 temporary directory and mode-600 outputs, suppresses dump/encryption command details, produces an age-encrypted tar archive and a small JSON manifest containing project ref, timestamps, tool versions, components and ciphertext SHA-256 (no row contents). It removes temporary plaintext files on exit. `shred` is best-effort and cannot guarantee erasure on SSD, copy-on-write, or journaled storage; use an encrypted local volume and avoid swap/snapshots that retain plaintext. If encryption or cleanup fails, treat the run as failed and securely dispose of the host's temporary storage before retrying.

Before upload, independently verify the manifest and ciphertext hash, inspect only archive metadata, and confirm the project reference is correct. In the owner's private Google Drive folder, create/use a dedicated `supabase-db-backups/<project-ref>/` namespace and manually upload only the `.tar.age` file and its manifest. Do not share the folder publicly or broaden existing permissions. Confirm the uploaded ciphertext hash matches the local manifest. Record completion time and result without user names or row contents.

## Daily operation, retention, and alerting

An operator may install a daily host scheduler only after they have provisioned protected credentials, age public recipient/private key custody and recovery, a reliable host, and an alert destination. Schedule at a stable UTC time. Verify a successful encrypted upload every day; investigate and alert on a missed run within the 24-hour RPO window. This repository contains no activated schedule.

Keep each artifact/manifest for 30 days, then delete only expired files inside this dedicated project namespace after checking the manifest timestamp and project ref. Never use a broad Drive cleanup query or delete files outside this namespace. Test the retention selection with a dry run first and keep a separate audit record of deleted artifact IDs/timestamps. Preserve the age private key for at least as long as any backup encrypted to its public recipient is retained.

## Restore rehearsal

At least quarterly, and after changes to this workflow, use a newly created empty local database whose name begins `hr_restore_`; use a loopback URL and never a production destination. Download ciphertext from the private folder, verify the ciphertext SHA-256 against its manifest, then inject `AGE_IDENTITY_FILE` and `RESTORE_DB_URL` securely and run:

```sh
database/scripts/backup/restore-local-encrypted-backup.sh /secure/path/backup.tar.age /secure/path/backup.tar.age.manifest.json hr_restore_rehearsal_YYYYMMDD
```

The restore helper refuses non-loopback hosts or a database name mismatch, verifies the manifest's ciphertext SHA-256 before decryption, validates archive members as regular files with exact safe names before extraction, checks the Auth customization component hash, and refuses a target without initialized Auth schema, zero Auth users, and empty application/migration-history contents. It restores roles, schema, migration-history schema, custom Auth triggers, then data and migration-history rows in order, and deletes temporary plaintext on exit. The operator must then check expected schema, roles, migration history, row counts using approved aggregate checks, critical policies/triggers/extensions, and application smoke tests using synthetic accounts. Record elapsed time and evidence without copying personal rows. To meet the RTO, complete this full rehearsal within four hours.

Do not use `--clean`, `supabase db reset --linked`, or any remote restore command. A successful SQL restore alone does not restore Auth platform configuration or Storage file bytes.

## Synthetic guard tests

Run `bash database/scripts/backup/test-guards.sh` to test target/ref mismatch rejection, percent-decoded password routing through `PGPASSWORD` with no secret in CLI argv/artifacts, roles/schema/data/migration-history command selection, and presence of synthetic outputs and a non-sensitive manifest. This stubs Supabase CLI and age. Run `bash database/scripts/backup/test-age-roundtrip.sh` for an actual age ephemeral-key encrypt/decrypt/hash/no-plaintext round trip on synthetic SQL. Run `bash database/scripts/backup/test-restore-flow.sh` for real age encryption/decryption with stubbed psql to exercise manifest/hash, archive-safety, loopback/refusal, and empty-target orchestration. These tests do not prove a real database restore; they do not connect to Supabase, Drive, or any production system. A full isolated CLI/Docker plus initialized local Supabase PG17.6 restore rehearsal remains required.

## Official references checked 2026-10-01

- [Supabase Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore): dump/restore order, restore behavior, customizations in managed schemas, Vault/column encryption, migration-history and role considerations.
- [Supabase CLI `db dump` reference](https://supabase.com/docs/reference/cli/supabase-orgs#supabase-db-dump): managed-schema filtering, default dump scope, supported flags, and containerized `pg_dump` behavior.
- [Supabase Storage Download Objects](https://supabase.com/docs/guides/storage/management/download-objects): object bytes and metadata are separate; bulk object backup has a separate workflow.
- [Supabase CLI automated backups](https://supabase.com/docs/guides/deployment/ci/backups): official example sequence for periodic CLI database dumps; this repository does not enable its CI approach.
- [Supabase CLI v2.119.0 source](https://github.com/supabase/cli/tree/v2.119.0/apps/cli/src/command-internal): reviewed DB URL password fallback, PGPASSWORD container forwarding, schema/data exclusions and Postgres major selection.
