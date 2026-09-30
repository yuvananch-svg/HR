-- Administrator setup. All fixture identifiers are reserved for this test.
begin;
do $$ begin
  if exists(select 1 from auth.users where id='d4000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.employees where id='d4000000-0000-4000-8000-000000000002')
     or exists(select 1 from public.leave_types where id='d4000000-0000-4000-8000-000000000003')
     or exists(select 1 from public.employees where employee_code='P4-CONCURRENCY')
     or exists(select 1 from public.leave_types where lower(btrim(name))='p4 concurrency fixture') then
    raise exception 'phase4 concurrency fixture UUID collision; clean up or choose new UUIDs';
  end if;
  if exists(select 1 from public.leave_policy_defaults where year=2098)
     or exists(select 1 from public.leave_entitlements where year=2098) then
    raise exception 'year 2098 already has policy or entitlement data; choose a clean test year';
  end if;
  if exists(select 1 from public.leave_types where is_active) then
    raise exception 'phase4 concurrency setup expects no other active leave types';
  end if;
end $$;
insert into hr_private.account_invites(email,role) values('phase4-concurrency@example.invalid','hr');
insert into auth.users(id,email) values('d4000000-0000-4000-8000-000000000001','phase4-concurrency@example.invalid');
insert into public.app_users(id,role,is_active) values('d4000000-0000-4000-8000-000000000001','hr',true);
insert into public.employees(id,employee_code,first_name,last_name,start_date)
values('d4000000-0000-4000-8000-000000000002','P4-CONCURRENCY','Phase4','Concurrency','2020-01-01');
insert into public.leave_types(id,name,is_active,sort_order)
values('d4000000-0000-4000-8000-000000000003','P4 concurrency fixture',true,100000);
insert into public.leave_policy_defaults(leave_type_id,year,quota_days)
values('d4000000-0000-4000-8000-000000000003',2098,1.0);
select count(*) as expected_total_generation_count from public.employees where status='active';
commit;
