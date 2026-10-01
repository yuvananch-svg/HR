-- Permanent, synthetic local-only actors required by Phase 6 read tests.
-- The trigger creates app_users after insertion of confirmed invited users.
insert into hr_private.account_invites(email, role)
values ('hr-regression-owner@example.invalid','owner'),
       ('hr-regression-hr@example.invalid','hr');

insert into auth.users(id,email,email_confirmed_at)
values ('76000000-0000-4000-8000-000000000001','hr-regression-owner@example.invalid',now()),
       ('76000000-0000-4000-8000-000000000002','hr-regression-hr@example.invalid',now());
