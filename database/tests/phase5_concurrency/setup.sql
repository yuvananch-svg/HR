-- Administrator setup for the Phase 5 two-session overlapping-save race.
-- Fixed IDs are reserved by this test. Setup commits isolated fixture rows.
begin;
do $$ begin
  if exists(select 1 from auth.users where id='d5000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.employees where id='d5000000-0000-4000-8000-000000000002')
     or exists(select 1 from public.leave_types where id='d5000000-0000-4000-8000-000000000003')
     or exists(select 1 from hr_private.account_invites where email='phase5-concurrency-2097@example.invalid')
     or exists(select 1 from public.employees where employee_code='P5-CONCURRENCY')
     or exists(select 1 from public.leave_types where lower(btrim(name))='p5 concurrency fixture') then
    raise exception 'Phase 5 concurrency fixture collision; clean up or choose another test year';
  end if;
end $$;
insert into hr_private.account_invites(email,role) values('phase5-concurrency-2097@example.invalid','hr');
insert into auth.users(id,email) values('d5000000-0000-4000-8000-000000000001','phase5-concurrency-2097@example.invalid');
insert into public.app_users(id,role,is_active,display_name) values('d5000000-0000-4000-8000-000000000001','hr',true,'Phase 5 concurrency');
insert into public.employees(id,employee_code,first_name,last_name,start_date)
values('d5000000-0000-4000-8000-000000000002','P5-CONCURRENCY','Phase5','Concurrency','2020-01-01');
insert into public.leave_types(id,name,is_active,sort_order)
values('d5000000-0000-4000-8000-000000000003','P5 concurrency fixture',true,100000);
insert into public.leave_policy_defaults(leave_type_id,year,quota_days)
values('d5000000-0000-4000-8000-000000000003',2097,1.0);
insert into public.leave_entitlements(employee_id,leave_type_id,year,quota_days,source)
values('d5000000-0000-4000-8000-000000000002','d5000000-0000-4000-8000-000000000003',2097,1.0,'policy');
commit;
