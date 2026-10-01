# Synthetic Supabase CLI backup round trip

`test-cli-synthetic-roundtrip.mjs` is an opt-in GitHub Actions rehearsal for the encrypted backup and local restore helpers. It requires Supabase CLI 2.119.0, Docker, PostgreSQL 17 `psql` on the host, and `age`/`age-keygen`. It also needs exclusive use of local ports 54321 and 54322 while it runs. The source and target are separate randomly named local Supabase projects; the source is stopped before the target starts so they can reuse those ports.

The script creates only synthetic `.invalid` Auth users and a reserved HR fixture. The fake remote project URL exists only to exercise the backup helper's URL validation; a strict temporary CLI shim rewrites the approved dump forms to `supabase db dump --local`. It rejects other URLs, arguments, and output paths. Credentials, CLI status, and the age identity stay in a private runner temporary directory or process environment. The rehearsal does not upload archives or claim that a production backup has been tested.

The target database is `hr_restore_synthetic`, initialized from the target stack's managed baseline. The restore helper permits absent or empty migration history, but the actual CLI migration-history schema dump may conflict with a preexisting empty `supabase_migrations.schema_migrations` table. CI must verify that helper-side behavior before treating this rehearsal as passing; the harness intentionally exercises the helper rather than bypassing it.

This rehearsal has not been run in a Docker-capable environment during local authoring. CI execution is required to validate the pinned CLI's container labels and dump behavior.
