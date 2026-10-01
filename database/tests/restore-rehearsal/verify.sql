-- Verify the restored synthetic graph, balance logic, RLS, and client write denial.
begin;
do $$
declare used_days numeric; cancelled_days numeric; recorded_count integer; cancelled_count integer;
begin
  if not exists(select 1 from public.employees where id='a7000000-0000-4000-8000-000000000001' and employee_code='P7-RESTORE-EMPLOYEE')
     or (select count(*) from public.identity_documents where employee_id='a7000000-0000-4000-8000-000000000001')<>1
     or (select count(*) from public.bank_accounts where employee_id='a7000000-0000-4000-8000-000000000001' and is_primary)<>1
     or (select count(*) from public.emergency_contacts where employee_id='a7000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'restored employee details graph differs';
  end if;
  if not exists(select 1 from public.leave_types where id='a7000000-0000-4000-8000-000000000002' and name='P7 Restore Rehearsal')
     or not exists(select 1 from public.leave_policy_defaults where leave_type_id='a7000000-0000-4000-8000-000000000002' and year=2096 and quota_days=12)
     or not exists(select 1 from public.leave_entitlements where employee_id='a7000000-0000-4000-8000-000000000001'
        and leave_type_id='a7000000-0000-4000-8000-000000000002' and year=2096 and quota_days=12 and source='policy')
     or not exists(select 1 from public.holidays where id='a7000000-0000-4000-8000-000000000003' and holiday_date=date '2096-01-03') then
    raise exception 'restored leave policy, entitlement, or holiday missing';
  end if;
  select count(*) filter(where status='recorded'), count(*) filter(where status='cancelled')
    into recorded_count,cancelled_count from public.leave_entries where employee_id='a7000000-0000-4000-8000-000000000001';
  if recorded_count<>1 or cancelled_count<>1 then raise exception 'recorded/cancelled leave rows differ'; end if;
  select sum(d.days) filter(where e.status='recorded'), sum(d.days) filter(where e.status='cancelled')
    into used_days,cancelled_days from public.leave_entry_days d join public.leave_entries e on e.id=d.leave_entry_id
    where e.employee_id='a7000000-0000-4000-8000-000000000001';
  if used_days<>2 or cancelled_days<>1 then raise exception 'recorded/cancelled stored charges differ'; end if;
  if (select count(*) from public.leave_entry_requests where actor_id='76000000-0000-4000-8000-000000000001')<>3
     or (select count(*) from public.audit_events where table_name='leave_entries' and record_id in
        (select id from public.leave_entries where employee_id='a7000000-0000-4000-8000-000000000001'))<>3 then
    raise exception 'request ledger/audit graph differs';
  end if;
  if exists(select 1 from public.leave_entries e left join public.employees p on p.id=e.employee_id where p.id is null)
     or exists(select 1 from public.leave_entries e left join public.leave_types t on t.id=e.leave_type_id where t.id is null)
     or exists(select 1 from public.leave_entry_days d left join public.leave_entries e on e.id=d.leave_entry_id where e.id is null)
     or exists(select 1 from public.leave_entry_requests r left join public.leave_entries e on e.id=r.entry_id where e.id is null)
     or exists(select 1 from public.audit_events a left join public.app_users u on u.id=a.actor_id where a.actor_id is not null and u.id is null) then
    raise exception 'restored relationship contains an orphan row';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"76000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare p jsonb;
begin
  if (select count(*) from public.employees where id='a7000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'restored active owner cannot read employee';
  end if;
  p:=public.preview_leave_entry('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000002',
    date '2096-01-06',date '2096-01-06','full',null);
  if (p->'balances'->0->>'used_before')::numeric<>2
     or (p->'balances'->0->>'remaining_after')::numeric<>9 then
    raise exception 'restored balance differs from recorded-only charge';
  end if;
  begin
    insert into public.leave_entries(employee_id,leave_type_id,start_date,end_date,day_unit,recorded_by)
    values('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000002',date '2096-01-06',date '2096-01-06','full','76000000-0000-4000-8000-000000000001');
    raise exception 'direct leave write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from hr_private.account_invites;
    raise exception 'direct allowlist read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.employees where id='a7000000-0000-4000-8000-000000000001') then
    raise exception 'restored RLS exposed employee to a nonmember';
  end if;
  begin
    perform public.preview_leave_entry('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000002',
      date '2096-01-06',date '2096-01-06','full',null);
    raise exception 'restored RPC accepted a nonmember';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ begin
  begin
    perform 1 from public.employees;
    raise exception 'restored anonymous table read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'PASS: restored synthetic graph, FK relationships, recorded-only balance, owner access, nonmember/anon denial, and RPC-only leave writes' as result;
rollback;
