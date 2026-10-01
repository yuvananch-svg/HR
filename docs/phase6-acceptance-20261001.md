# Phase 6 implementation and acceptance — 2026-10-01

Status: implementation reviewed, with local verification passed. Production owner browser QA and mobile viewport QA remain open. HR browser QA is deferred at the user's request. This report does not declare Phase 6 fully accepted.

## Implemented scope

- Strict history URL filters for employee, type, status, year, inclusive interval overlap, explicit date intersection and name/code tokens. Invalid values are shown in Thai; unsupported wildcard asterisks are rejected rather than broadening the search.
- Server-side history pagination with exact counts, 25 rows per page, stable created-at/ID order and out-of-range page clamping. Detail and successful form navigation retain a validated history return path.
- Selected-year dashboard type totals and charged-day usage; today counts distinct employees, including beyond the API response cap through paged reads.
- Shared recorded-day usage by employee/type/year across balances. Cancelled entries remain in history but are excluded from usage. Zero quota is distinguished from missing entitlement; inactive historical types remain readable.
- Employee detail reads selected-year balances and bounded recent history with a link to the filtered full history. Existing mutation RPCs, authorization and revalidation remain in place; no migration or new access grant is required.

## Verified evidence

- Final implementation checks passed: 14 test files / 72 tests, TypeScript (`npx tsc --noEmit`), ESLint, production build and `git diff --check`. The Supabase SDK regression captures actual serialized request filters, exact counts, deterministic page order and clamped offsets; permission and empty-intersection tests verify no database request occurs before the staff guard or for an empty range.
- Actual-schema SQL regression passed on HRM using transaction-local synthetic fixtures: 1,005 history entries, stable disjoint 25-row pages, 1,001 distinct employees on a date, 1,002 annual recorded days, half-day deduplication, cancelled exclusion, cross-year history, and zero/missing entitlement.
- Existing active owner and HR database roles read the fixture; uninvited and anonymous reads were denied. The regression resolved membership IDs internally, changed no credentials or memberships, and rolled back. Follow-up Phase 6 fixture employee/type counts were both zero.
- Read-only EXPLAIN and existing index review found no evidence requiring a new index at the current small production volume. This is not a load benchmark.
- Real anonymous REST requests with ordinary and special-character search terms reached permission denial, without a filter parse error. This does not establish authenticated matching behavior.

## Remaining acceptance

- Record the published commit and deployment result after rollout.
- Complete owner browser verification of combined filters, page/detail return paths, year selection, matching balances and mutation refresh on the deployed build.
- Verify rendered desktop/375px layouts, keyboard use, loading/error/empty states and document overflow. CSS and unit checks do not replace live viewport evidence.
- Keep HR browser QA deferred and Phase 5 fixture cleanup as separate follow-ups. This round's rollback fixture cleanup does not claim the earlier fixtures were removed.

Public evidence contains no screenshots, credentials, private account identifiers or raw production records.
