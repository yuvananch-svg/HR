# Supabase environment configuration

Set all three public variables explicitly for every environment. The current source configuration has no embedded production URL/key fallback and does not infer a missing production target.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | HTTPS URL for the Supabase project used by this deployment. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key, or legacy anon JWT, used by browser and server clients. Never use a `service_role` or `sb_secret_` key here. |
| `NEXT_PUBLIC_SUPABASE_TARGET` | One of `development`, `preview`, `production`, or `test`; must describe the intended data environment. |

Local development should use a disposable local Supabase instance or a separate non-production project and set target `development` in an untracked `.env.local`; local Supabase HTTP URLs on `localhost` or `127.0.0.1` are accepted only for development/test. Vercel Preview must use a separate non-production project and target `preview`. The known production project (`kedohmbtpegupndldkex.supabase.co`) is rejected for both targets. Vercel Production must set target `production`; the runtime also verifies Vercel's deployment marker and the approved production host. In this source revision, missing, blank, or partially configured URL/key/target values fail when a client is created in every environment. The user approved setting all three production variables on 2026-10-01; they were configured in Vercel Production, the redeployment reached Ready, and the owner leave page loaded existing HRM data after reload. Strict source was published in d4fcc00, with subsequent rehearsal-only fixes through c9f9ad3. Hosted CI passed and Vercel Production reached Ready; owner read-only smoke of dashboard, employee list, leave and settings passed.

Keep keys in the local environment file or deployment environment settings; do not commit them or print them in build logs. CI uses a synthetic `fixture.supabase.co` URL and fake `sb_publishable_` value with target `test`. The fixture exists only to compile and run unit tests; it does not represent a reachable project and must never be used for data mutations.
