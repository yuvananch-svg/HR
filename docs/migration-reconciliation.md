# Migration history reconciliation — 2026-10-01

Read-only comparison of the HRM migration ledger and checked-in SQL. No production SQL, migration replay, or history repair was performed. Different timestamps refer to the same reviewed SQL; the three files in `supabase/migrations` are not a complete fresh-install history. Fresh isolated bootstrap remains `database/scripts/local-regression.mjs`.

| Remote version | Remote name | Source and comparison |
| --- | --- | --- |
| 20260930001625 | hr_foundation_tables_and_rls | Body of `database/hr_foundation.sql` matches after removing comments and normalizing whitespace. |
| 20260930001724 | restrict_internal_rls_event_trigger_execution | Revoke of `public.rls_auto_enable()`; source wraps the same revoke in an existence check for vanilla PostgreSQL. |
| 20260930002838 | hr_invited_accounts_and_verified_membership | Body of `database/hr_accounts.sql` matches after removing comments and normalizing whitespace. |
| 20260930003821 | explicitly_deny_client_invitation_access | The final deny policy in `database/hr_accounts.sql`. |
| 20260930023953 | phase3_employee_registry | `database/phase3_employees.sql` exact MD5: `41234de647170c08c7b64db63c1369c6`. |
| 20260930070704 | phase4_leave_policy | Source and checkout migration `20260930064338`: exact MD5 `167679dac472ff660223dc27d3d960a3`. |
| 20260930103819 | phase5_leave_entries | Source and checkout migration `20260930103255`: exact MD5 `5aace6a80381aa9cd86044c33db26540`. |
| 20260930104027 | phase5_request_ledger_guards | Source and checkout migration `20260930103927`: exact MD5 `bd1a55f76d85dc1bfbc3f1b07eeffdde`. |

Hashes are comparison checks, not cryptographic backup integrity guarantees. Do not run `supabase db push` against this production project using the incomplete/differently numbered directory. New changes must be created as a new migration after reviewing remote history. Before replacing the existing migration layout with a CLI-managed baseline, rehearse that transition separately; this map does not modify the ledger or prove absence of manual schema drift.
