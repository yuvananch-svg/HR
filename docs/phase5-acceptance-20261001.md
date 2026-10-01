# Phase 5 acceptance — 2026-10-01 (Asia/Bangkok)

Status: core Phase 5 work accepted by the user on 2026-10-01. Items 5.8–5.9 are accepted with explicit follow-ups: HR browser QA is deferred at the user's request; final synthetic-fixture cleanup remains outstanding. This does not claim all-account QA or completed cleanup.

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
- Guarded cleanup of synthetic Phase 5 data after HR QA. Keep real employees/accounts and unrelated audit unchanged. Pre-existing synthetic fixtures remain available for this test; rollback-only regression fixtures do not remain.
- The user explicitly accepted the core work and asked to update the plan while skipping HR for now. Keep these follow-ups open and record their results when completed.

This public report intentionally contains no screenshots, account identifiers, employee personal information, session data or raw production records.
