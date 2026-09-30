-- Administrator cleanup; only removes the fixed Phase 5 concurrency fixture.
begin;
do $$ begin
  if exists(select 1 from public.leave_entries where employee_id='d5000000-0000-4000-8000-000000000002'
       and not (start_date='2097-01-07' and end_date='2097-01-07' and reason in ('session A','session B'))) then
    raise exception 'unexpected employee leave row; refusing cleanup';
  end if;
end $$;
delete from public.leave_entry_requests where actor_id='d5000000-0000-4000-8000-000000000001';
delete from public.audit_events where table_name='leave_entries' and record_id in
  (select id from public.leave_entries where employee_id='d5000000-0000-4000-8000-000000000002');
delete from public.leave_entry_days where leave_entry_id in
  (select id from public.leave_entries where employee_id='d5000000-0000-4000-8000-000000000002');
delete from public.leave_entries where employee_id='d5000000-0000-4000-8000-000000000002';
delete from public.leave_entitlements where employee_id='d5000000-0000-4000-8000-000000000002'
  and leave_type_id='d5000000-0000-4000-8000-000000000003' and year=2097;
delete from public.leave_policy_defaults where leave_type_id='d5000000-0000-4000-8000-000000000003' and year=2097;
delete from public.leave_types where id='d5000000-0000-4000-8000-000000000003' and name='P5 concurrency fixture';
delete from public.employees where id='d5000000-0000-4000-8000-000000000002' and employee_code='P5-CONCURRENCY';
delete from public.app_users where id='d5000000-0000-4000-8000-000000000001' and display_name='Phase 5 concurrency';
delete from auth.users where id='d5000000-0000-4000-8000-000000000001' and email='phase5-concurrency-2097@example.invalid';
delete from hr_private.account_invites where email='phase5-concurrency-2097@example.invalid' and role='hr';
commit;
select
 (select count(*) from public.employees where id='d5000000-0000-4000-8000-000000000002') as employees,
 (select count(*) from public.leave_types where id='d5000000-0000-4000-8000-000000000003') as leave_types,
 (select count(*) from public.leave_policy_defaults where leave_type_id='d5000000-0000-4000-8000-000000000003') as policy_defaults,
 (select count(*) from public.leave_entitlements where employee_id='d5000000-0000-4000-8000-000000000002') as entitlements,
 (select count(*) from public.leave_entries where employee_id='d5000000-0000-4000-8000-000000000002') as leave_entries,
 (select count(*) from public.leave_entry_days where leave_entry_id in
   (select id from public.leave_entries where employee_id='d5000000-0000-4000-8000-000000000002')) as leave_entry_days,
 (select count(*) from public.leave_entry_requests where actor_id='d5000000-0000-4000-8000-000000000001') as requests,
 (select count(*) from public.audit_events where actor_id='d5000000-0000-4000-8000-000000000001') as audit_events,
 (select count(*) from public.app_users where id='d5000000-0000-4000-8000-000000000001') as app_users,
 (select count(*) from auth.users where id='d5000000-0000-4000-8000-000000000001') as auth_users,
 (select count(*) from hr_private.account_invites where email='phase5-concurrency-2097@example.invalid') as invites;
