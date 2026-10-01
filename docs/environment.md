# Supabase environment configuration

Set all three public variables explicitly for every environment; a tightly scoped production continuity fallback is documented below:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | HTTPS URL for the Supabase project used by this deployment. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key, or legacy anon JWT, used by browser and server clients. Never use a `service_role` or `sb_secret_` key here. |
| `NEXT_PUBLIC_SUPABASE_TARGET` | One of `development`, `preview`, `production`, or `test`; must describe the intended data environment. |

Local development should use a disposable local Supabase instance or a separate non-production project and set target `development` in an untracked `.env.local`; local Supabase HTTP URLs on `localhost` or `127.0.0.1` are accepted only for development/test. Vercel Preview must use a separate non-production project and target `preview`. The known production project (`kedohmbtpegupndldkex.supabase.co`) is rejected for both targets. Vercel Production should set target `production`; the runtime also verifies Vercel's deployment marker and the approved production host. During transition, an unset target is inferred as `production` only when both `VERCEL_ENV=production` and `NODE_ENV=production`. A legacy URL/key fallback is available only in that same production runtime and only when both variables are truly unset; it cannot activate in preview or local development. Remove the fallback and require the explicit production variables after verifying deployment settings. Explicitly blank or partially configured URL/key values still fail. On 2026-10-01 the user explicitly approved setting all three variables. They were saved in Vercel Production only and the production redeployment reached Ready; the owner leave page loaded the existing HRM data after reload. Removing the continuity fallback and verifying missing-production-variable failure remain rollout follow-ups.

Keep keys in the local environment file or deployment environment settings; do not commit them or print them in build logs. CI uses a synthetic `fixture.supabase.co` URL and fake `sb_publishable_` value with target `test`. The fixture exists only to compile and run unit tests; it does not represent a reachable project and must never be used for data mutations.
