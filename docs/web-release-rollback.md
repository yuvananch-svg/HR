# Web release and rollback rehearsal

`database/scripts/web-release-rollback.mjs` is prepared to exercise the current web candidate against the disposable full Supabase stack provisioned by the `fullstack-supabase` CI job. Hosted browser-runtime acceptance is pending. The runner signs in as the generated `.invalid` owner through real local Supabase Auth, uses the app’s real server actions and PostgREST, and never receives the local service-role key.

The runner first rejects missing synthetic-only confirmation, any non-loopback API URL, any API port other than `54321`, URL credentials/query/fragment, a non-`.invalid` owner, and a privileged browser key. It builds detached worktrees for the current commit and the pinned compatible predecessor `819864cffa3bd72fa3229b2cea9c960893b0e74b`, using each source revision’s committed lockfile. Builds receive only the explicit local HTTP URL, anon/publishable key, and `NEXT_PUBLIC_SUPABASE_TARGET=test`; any `.env`, `.env.local`, `.env.production`, or `.env.production.local` file in either worktree stops the run.

On the current candidate, Chromium runs a desktop owner journey that checks failed-login feedback and successful keyboard retry, keyboard tab order in the employee form, employee creation, leave-type and annual-policy configuration, holiday setup, entitlement generation, leave preview/save/edit/cancel, audit/history, and dashboard. A 375-pixel mobile pass checks the overview, employee list, settings, and leave history for horizontal page overflow, then signs out and confirms direct workspace access redirects to login.

The runner stops the current web server and starts the pinned predecessor against the same unchanged local database. It checks unauthenticated denial, owner sign-in, dashboard, and cancelled-history access. Before and after each version switch, an authenticated anon-key PostgREST read compares a canonical snapshot of the owner membership and relevant HR application tables, including synthetic employee, type, policy, entitlement, holiday, leave ledger, and audit rows. It also compares the authenticated PostgREST OpenAPI schema hash. It then rebuilds and restarts the current candidate and repeats the read-only smoke and invariant checks. No database reset or rollback occurs during a version switch.

The browser-created rows are synthetic and exist only inside the ephemeral CI Supabase stack. The final CI cleanup destroys that stack and its local database, removing both the baseline and browser fixtures. No screenshots, videos, browser traces, database archives, access tokens, or raw API responses are uploaded or printed. Logs omit fixture values and show source refs, stage labels, the loopback stack address, and truncated invariant hashes.

The isolated harness expects these CI variables, supplied from the local Supabase bootstrap step:

- `LOCAL_TEST_CONFIRM=I_UNDERSTAND_LOCAL_SYNTHETIC_ONLY`
- `LOCAL_SUPABASE_URL=http://127.0.0.1:54321`
- `LOCAL_SUPABASE_ANON_KEY` (legacy anon JWT or publishable key)
- `LOCAL_TEST_OWNER_EMAIL` and `LOCAL_TEST_OWNER_PASSWORD` for a generated synthetic `.invalid` owner

Run the fail-closed guard checks with `npm run test:web-release-guards`. Run the complete browser and rollback rehearsal only after the dedicated local Supabase stack is healthy, and install the Chromium build matching the pinned Playwright package with `npx playwright install --with-deps chromium`.

This rehearsal covers the owner web path and a read-only compatibility smoke for the predecessor. The separate CI Auth/API checks own HR-role authorization coverage. It does not prove rollback against production data, backups, Vercel DNS/secrets, or an actual production database; those remain deployment and restore-operations gates.
