# Phase 6 implementation and acceptance — 2026-10-01

Status: implementation reviewed; owner production browser checks and simulated 375px mobile checks passed for the flows below. HR browser QA remains deferred at the user's request. Phase 6.1–6.9 is complete within this scope, using the code, automated, SQL and browser evidence below. This does not imply every scenario was exercised through the browser.

## Implemented scope

- Strict history URL filters for employee, type, status, year, inclusive interval overlap, explicit date intersection and name/code tokens. Invalid values are shown in Thai; unsupported wildcard asterisks are rejected rather than broadening the search.
- Server-side history pagination with exact counts, 25 rows per page, stable created-at/ID order and out-of-range page clamping. Detail and successful form navigation retain a validated history return path.
- Selected-year dashboard type totals and charged-day usage; today counts distinct employees, including beyond the API response cap through paged reads.
- Shared recorded-day usage by employee/type/year across balances. Cancelled entries remain in history but are excluded from usage. Zero quota is distinguished from missing entitlement; inactive historical types remain readable.
- Employee detail reads selected-year balances and bounded recent history with a link to the filtered full history. Existing mutation RPCs, authorization and revalidation remain in place; no migration or new access grant is required.

## Verified evidence

- Final implementation checks passed: 14 test files / 72 tests, TypeScript (`npx tsc --noEmit`), ESLint, production build and `git diff --check`. The Supabase SDK regression captures actual serialized request filters, exact counts, deterministic page order and clamped offsets; permission and empty-intersection tests verify no database request occurs before the staff guard or for an empty range.
- Reviewed implementation commit [`ce5bf7f`](https://github.com/yuvananch-svg/HR/commit/ce5bf7f523a8855460999370a19c2a497a052cec) was published to `main`. The Vercel status for this commit succeeded, and the production build is available at https://hr-lac-theta.vercel.app. The published tree matches the locally verified tree; private screenshots were excluded.
- Actual-schema SQL regression passed on HRM using transaction-local synthetic fixtures: 1,005 history entries, stable disjoint 25-row pages, 1,001 distinct employees on a date, 1,002 annual recorded days, half-day deduplication, cancelled exclusion, cross-year history, and zero/missing entitlement.
- Existing active owner and HR database roles read the fixture; uninvited and anonymous reads were denied. The regression resolved membership IDs internally, changed no credentials or memberships, and rolled back. Follow-up Phase 6 fixture employee/type counts were both zero.
- Read-only EXPLAIN and existing index review found no evidence requiring a new index at the current small production volume. This is not a load benchmark.
- Real anonymous REST requests with ordinary and special-character search terms reached permission denial, without a filter parse error. This does not establish authenticated matching behavior.

## Production browser verification

- Owner selected 2026/2027 on the dashboard and compared selected-year totals. Combined full-name, employee, type, recorded status and year filters returned 26 synthetic entries: page one contained 25 and page two one, with no duplicate IDs. Detail-to-history navigation preserved page two and all filters.
- Inclusive date filtering for two adjacent synthetic dates returned two entries while annual balance stayed 30 quota / 26 used / 4 remaining. A year/date intersection with no overlap returned zero with a Thai empty state. Reversed dates and unsupported `*` search displayed Thai validation errors and withheld history results. The cancelled filter for the synthetic employee returned its one cancelled entry.
- Actual create full-day → edit morning half-day → cancel flow updated annual usage 26 → 27 → 26.5 → 26; leave, dashboard and employee detail showed the restored 30 / 26 / 4 balance. Detail showed all three audit actions. SQL independently verified the three request/audit records and final cancelled state.
- Employee detail showed missing entitlement separately and bounded recent history to 25 entries, with the full filtered-history link. Mobile detail opened the cancelled entry and linked to the employee's matching balance.
- Simulated mobile iframe was 375px wide; document/body were 360px with the scrollbar and no document overflow. A live readability defect in dashboard headers was fixed in [`5c38bb9`](https://github.com/yuvananch-svg/HR/commit/5c38bb9b865981e33f879d7b2d28baeb8eb4afb9): wrapped tables have a 520px minimum width and non-wrapping headers. Production computed styles confirmed all five headers `nowrap`, with internal horizontal scrolling; the rendered screenshot confirmed readable headings. CSS-only lint/build passed and Vercel deployment succeeded.
- Loading text was observed during navigation. Keyboard Tab checks reached main navigation and moved from the search box to the employee select; clearing filters returned the clean history URL. This is not a full accessibility audit, physical-device test or simulated network-outage test.

## Cleanup and follow-ups

- This round's persistent browser fixture was removed with identity/count/dependency guards in a transaction: 27 entries, 27 charged-day rows, three request rows, three audit rows, one entitlement, one employee and one type. A separate query confirmed zero remaining scoped fixtures. Unrelated table counts were unchanged; credentials and memberships were untouched.
- Phase 5 fixture cleanup remains a separate existing follow-up. This cleanup does not claim those earlier fixtures were removed.
- HR browser QA remains deferred. SQL role checks establish database read permissions, not HR browser acceptance.
- Focused actual-schema [mutation regression](../database/tests/phase6_mutation_refresh.sql) passed with rollback: moving a full-day entry from type A/year 2098 to type B/year 2099 morning half-day cleared old annual usage/history and populated the new scope; quota 4 → 5 gave remaining 4.5; holiday create/move/delete preserved stored charged days; stale-revision failure left entry/day/audit/request records unchanged. Three targeted test files / 28 tests passed. Follow-up fixture counts were zero and baseline counts unchanged. Existing owner identity was resolved internally; no credentials, grants or memberships changed.
- Read-path invalidation was reviewed for successful mutations and quota/holiday changes. Employee reassignment is prohibited by the existing RPC; the same employee pathname serves year/type variants. Specific year/type and quota changes were SQL-tested, while create/edit/cancel refresh was browser-tested.
- The >1,000-row case was verified through rollback SQL plus paged-reader/SDK regression; it was not a production browser load benchmark.

Public evidence contains no screenshots, credentials, private account identifiers or raw production records. Private mobile evidence is retained separately.
