-- Administrator cleanup. Every delete is scoped to the reserved fixture UUIDs.
begin;
do $$ begin
  if exists(select 1 from public.leave_types where id='d4000000-0000-4000-8000-000000000003' and name<>'P4 concurrency fixture')
     or exists(select 1 from public.employees where id='d4000000-0000-4000-8000-000000000002' and employee_code<>'P4-CONCURRENCY')
     or exists(select 1 from auth.users where id='d4000000-0000-4000-8000-000000000001' and email<>'phase4-concurrency@example.invalid') then
    raise exception 'fixture identity changed; refusing cleanup';
  end if;
end $$;
delete from public.leave_entitlements
where leave_type_id='d4000000-0000-4000-8000-000000000003'
   or employee_id='d4000000-0000-4000-8000-000000000002';
delete from public.leave_policy_defaults where leave_type_id='d4000000-0000-4000-8000-000000000003';
delete from public.leave_types where id='d4000000-0000-4000-8000-000000000003';
delete from public.employees where id='d4000000-0000-4000-8000-000000000002';
delete from public.app_users where id='d4000000-0000-4000-8000-000000000001';
delete from auth.users where id='d4000000-0000-4000-8000-000000000001';
delete from hr_private.account_invites where email='phase4-concurrency@example.invalid';
select
  (select count(*) from public.leave_entitlements where employee_id='d4000000-0000-4000-8000-000000000002' or leave_type_id='d4000000-0000-4000-8000-000000000003') as entitlements_left,
  (select count(*) from public.leave_policy_defaults where leave_type_id='d4000000-0000-4000-8000-000000000003') as policies_left,
  (select count(*) from public.leave_types where id='d4000000-0000-4000-8000-000000000003') as types_left,
  (select count(*) from public.employees where id='d4000000-0000-4000-8000-000000000002') as employees_left,
  (select count(*) from auth.users where id='d4000000-0000-4000-8000-000000000001') as auth_users_left;
commit;
