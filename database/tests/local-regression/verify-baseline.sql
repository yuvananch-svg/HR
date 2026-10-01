-- Read-only guard for the two seeded local actors and an otherwise empty app.
do $$ begin
  if (select count(*) from public.app_users)<>2
     or exists(select 1 from public.app_users where is_active is distinct from true
               or not ((id='76000000-0000-4000-8000-000000000001' and role='owner')
                    or (id='76000000-0000-4000-8000-000000000002' and role='hr'))) then
    raise exception 'local regression baseline app_users changed';
  end if;
  if (select count(*) from auth.users)<>2
     or not exists(select 1 from auth.users where id='76000000-0000-4000-8000-000000000001' and email='hr-regression-owner@example.invalid')
     or not exists(select 1 from auth.users where id='76000000-0000-4000-8000-000000000002' and email='hr-regression-hr@example.invalid') then
    raise exception 'local regression baseline auth.users changed';
  end if;
  if (select count(*) from hr_private.account_invites)<>2
     or not exists(select 1 from hr_private.account_invites where email='hr-regression-owner@example.invalid' and role='owner' and is_active)
     or not exists(select 1 from hr_private.account_invites where email='hr-regression-hr@example.invalid' and role='hr' and is_active) then
    raise exception 'local regression baseline account invites changed';
  end if;
  if exists(select 1 from public.employees)
     or exists(select 1 from public.identity_documents)
     or exists(select 1 from public.bank_accounts)
     or exists(select 1 from public.emergency_contacts)
     or exists(select 1 from public.leave_types)
     or exists(select 1 from public.leave_policy_defaults)
     or exists(select 1 from public.leave_entitlements)
     or exists(select 1 from public.holidays)
     or exists(select 1 from public.leave_entries)
     or exists(select 1 from public.leave_entry_days)
     or exists(select 1 from public.leave_entry_requests)
     or exists(select 1 from public.audit_events) then
    raise exception 'local regression baseline application rows changed';
  end if;
end $$;
select 'PASS: baseline has only the two seeded actors/invites and no application fixture rows' as result;
