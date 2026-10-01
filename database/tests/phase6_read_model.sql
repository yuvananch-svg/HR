-- Run as administrator against the migrated HR schema. Everything rolls back.
-- Bulk fixtures exercise reads, not the create/edit/cancel RPC business rules.
begin;
do $$
declare seed text := gen_random_uuid()::text; owner_id uuid; hr_id uuid; type_id uuid := gen_random_uuid(); zero_type uuid := gen_random_uuid(); first_employee uuid;
begin
  select id into owner_id from public.app_users where role='owner' and is_active limit 1;
  select id into hr_id from public.app_users where role='hr' and is_active limit 1;
  if owner_id is null or hr_id is null then raise exception 'Existing active owner and HR required'; end if;
  perform set_config('hr.p6_owner',owner_id::text,true);
  perform set_config('hr.p6_hr',hr_id::text,true);
  perform set_config('hr.p6_type',type_id::text,true);
  perform set_config('hr.p6_zero_type',zero_type::text,true);
  perform set_config('hr.p6_seed',seed,true);
  insert into public.leave_types(id,name,is_active) values(type_id,'P6 rollback '||seed,true),(zero_type,'P6 zero '||seed,false);
  insert into public.employees(id,employee_code,first_name,last_name,start_date)
  select md5(seed||':employee:'||i)::uuid,'P6-QA-'||seed||'-'||i,'Synthetic','Read model '||i,date '2095-01-01' from generate_series(1,1001) i;
  first_employee := md5(seed||':employee:1')::uuid;
  perform set_config('hr.p6_employee',first_employee::text,true);
  insert into public.leave_entitlements(employee_id,leave_type_id,year,quota_days,source)
  select id,type_id,2096,10,'policy' from public.employees where employee_code like 'P6-QA-'||seed||'-%';
  insert into public.leave_entitlements(employee_id,leave_type_id,year,quota_days,source) values(first_employee,zero_type,2096,0,'policy');
  insert into public.leave_entries(id,employee_id,leave_type_id,start_date,end_date,day_unit,status,recorded_by,created_at)
  select md5(seed||':entry:'||i)::uuid,md5(seed||':employee:'||i)::uuid,type_id,date '2096-01-02',date '2096-01-02','full','recorded',owner_id,timestamptz '2096-01-01 00:00:00+00' from generate_series(1,1001) i;
  insert into public.leave_entry_days(leave_entry_id,leave_date,days)
  select id,date '2096-01-02',1 from public.leave_entries where leave_type_id=type_id;
  insert into public.leave_entries(id,employee_id,leave_type_id,start_date,end_date,day_unit,half_period,status,recorded_by,created_at)
  values(md5(seed||':morning')::uuid,first_employee,type_id,date '2096-12-31',date '2096-12-31','half','morning','recorded',owner_id,now()),
        (md5(seed||':afternoon')::uuid,first_employee,type_id,date '2096-12-31',date '2096-12-31','half','afternoon','recorded',owner_id,now()),
        (md5(seed||':cross')::uuid,first_employee,type_id,date '2096-12-31',date '2097-01-02','full',null,'recorded',owner_id,now());
  insert into public.leave_entry_days(leave_entry_id,leave_date,days,half_period)
  values(md5(seed||':morning')::uuid,date '2096-12-31',0.5,'morning'),(md5(seed||':afternoon')::uuid,date '2096-12-31',0.5,'afternoon'),(md5(seed||':cross')::uuid,date '2097-01-02',1,null);
  insert into public.leave_entries(id,employee_id,leave_type_id,start_date,end_date,day_unit,status,recorded_by,cancelled_by,cancelled_at,change_reason)
  values(md5(seed||':cancelled')::uuid,first_employee,type_id,date '2096-05-01',date '2096-05-01','full','cancelled',owner_id,owner_id,now(),'Synthetic cancellation');
  insert into public.leave_entry_days(leave_entry_id,leave_date,days) values(md5(seed||':cancelled')::uuid,date '2096-05-01',1);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.p6_owner'),'role','authenticated')::text,true);
do $$
declare n integer; used numeric; p1 uuid[]; p2 uuid[]; total numeric; seed text := current_setting('hr.p6_seed'); t uuid := current_setting('hr.p6_type')::uuid; e uuid := current_setting('hr.p6_employee')::uuid;
begin
  select count(*) into n from public.leave_entries where leave_type_id=t;
  if n<>1005 then raise exception 'owner exact count: %',n; end if;
  select count(distinct le.employee_id) into n from public.leave_entry_days d join public.leave_entries le on le.id=d.leave_entry_id where le.leave_type_id=t and le.status='recorded' and d.leave_date=date '2096-01-02';
  if n<>1001 then raise exception 'distinct people beyond API cap: %',n; end if;
  select count(distinct le.employee_id) into n from public.leave_entry_days d join public.leave_entries le on le.id=d.leave_entry_id where le.leave_type_id=t and le.status='recorded' and d.leave_date=date '2096-12-31';
  if n<>1 then raise exception 'morning and afternoon count one person'; end if;
  select sum(d.days) into used from public.leave_entry_days d join public.leave_entries le on le.id=d.leave_entry_id where le.employee_id=e and le.leave_type_id=t and le.status='recorded' and d.leave_date between date '2096-01-01' and date '2096-12-31';
  if used<>2 then raise exception 'recorded-only selected-year usage: %',used; end if;
  select sum(d.days) into total from public.leave_entry_days d join public.leave_entries le on le.id=d.leave_entry_id where le.leave_type_id=t and le.status='recorded' and d.leave_date between date '2096-01-01' and date '2096-12-31';
  if total<>1002 then raise exception 'aggregate beyond API cap: %',total; end if;
  select array_agg(id order by created_at desc,id desc) into p1 from (select id,created_at from public.leave_entries where leave_type_id=t order by created_at desc,id desc limit 25) x;
  select array_agg(id order by created_at desc,id desc) into p2 from (select id,created_at from public.leave_entries where leave_type_id=t order by created_at desc,id desc offset 25 limit 25) x;
  if cardinality(p1)<>25 or cardinality(p2)<>25 or p1 && p2 then raise exception 'stable tied pages failed'; end if;
  select count(*) into n from public.leave_entries where leave_type_id=t and start_date<=date '2097-01-01' and end_date>=date '2097-01-01';
  if n<>1 then raise exception 'cross-year historical overlap'; end if;
  if not exists(select 1 from public.leave_entitlements where employee_id=e and leave_type_id=current_setting('hr.p6_zero_type')::uuid and year=2096 and quota_days=0) then raise exception 'zero entitlement missing'; end if;
  if exists(select 1 from public.leave_entitlements where employee_id=md5(seed||':employee:2')::uuid and leave_type_id=current_setting('hr.p6_zero_type')::uuid and year=2096) then raise exception 'missing entitlement confused with zero'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.p6_hr'),'role','authenticated')::text,true);
do $$ begin if (select count(*) from public.leave_entries where leave_type_id=current_setting('hr.p6_type')::uuid)<>1005 then raise exception 'HR reads differ from owner'; end if; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
do $$ begin if exists(select 1 from public.leave_entries where leave_type_id=current_setting('hr.p6_type')::uuid) then raise exception 'uninvited reads allowed'; end if; end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ begin
  begin
    if exists(select 1 from public.leave_entries where leave_type_id=current_setting('hr.p6_type')::uuid) then raise exception 'anonymous reads allowed'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'PASS: actual-schema exact counts, >1000 distinct people/annual rows, half days, cancelled exclusion, cross-year history, tied pages, zero/missing entitlement, owner/HR/uninvited/anon reads; rollback follows' as result;
rollback;
