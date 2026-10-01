# Phase 5 acceptance — 2026-10-01 (Asia/Bangkok)

Status: core Phase 5 work accepted by the user on 2026-10-01. Items 5.8–5.9 are accepted with explicit follow-ups: HR browser QA is deferred at the user's request; synthetic-fixture cleanup completed on 2026-10-01 at the user’s request. This does not claim all-account QA.

## Completed checks

- Unit/UI tests: 61/61. ESLint, TypeScript and production build passed, including after the form fix.
- SQL regression: phases 3, 4 and 5 passed using rollback-only synthetic data. Foundation test passed with fixture-scoped assertions; its original assertions require an empty database.
- Access checks: active owner/HR allowed; anonymous, disabled and uninvited users denied. Application tables have RLS enabled.
- Owner production-browser workflow on synthetic data: created full-day leave, edited to morning half-day, cancelled with a reason. Charged days changed 1 → 0.5 → 0; the original balance returned. Audit recorded all three actions.
- Actual cross-type overlap race: two forms had valid previews for the same synthetic employee/date. A test transaction held the existing employee overlap lock while both submitted. Database activity confirmed two independent sessions waiting on the advisory lock. After release, one saved and the other received the Thai overlap error. Exactly one recorded entry, one charged day and one audit remained.
- Save vs quota override: a valid full-day preview was submitted while a separate transaction held the existing entitlement lock. The transaction reduced synthetic quota through the existing Phase 4 RPC. The waiting save then received the Thai insufficient-quota error. No partial entry/request was created; the original synthetic entitlement was restored.
- Mobile: list, detail and edit preview tested using the existing same-origin 375×900 CSS iframe. Document/body widths were 360/360px with no document overflow. This is viewport testing, not a physical iPhone.
- Real-browser issue found: resolving a rejected form action reset native controls. Fix `8aa69df` remounts the form from retained controlled state. Vercel deployed successfully. A rejected save on the deployed version retained employee, type, dates, reason, confirmation and request key; the insufficient-quota message remained visible. Failed entry/request count was zero.

## Deferred follow-ups

- Existing HR account: complete a real browser create/edit/cancel workflow and compare balances and audit. User sign-in is required; do not create or change credentials or roles for this check.
- Phase 5 fixtures have now been removed at the user’s request, before deferred HR QA. A future HR test must prepare a fresh scoped synthetic fixture.
- The user explicitly accepted the core work and asked to update the plan while skipping HR for now. Keep these follow-ups open and record their results when completed.

This public report intentionally contains no screenshots, account identifiers, employee personal information, session data or raw production records.

## Final fixture cleanup — 2026-10-01

Completed through a guarded transaction matching the exact synthetic employee/type identities, leave reasons, row counts and holiday identities. Removed six synthetic employees, four leave types, nine entries, twelve charged-day rows, twelve request rows, twelve entry audit rows, thirteen entitlements, five policy defaults and two fixture holidays. Unexpected personal dependencies or unrelated use of fixture types would abort cleanup.

An independent follow-up query confirmed zero remaining scoped Phase 5 employees/types/holidays and zero leave entries/days/requests/entitlements/policies/audits. The real employee remains. Existing employee/type/entry/audit/account rows outside the fixture were compared inside the transaction and unchanged; both application accounts remain. No credentials, roles, auth accounts or invitations were modified.
