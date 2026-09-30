-- Run as database administrator after phase4_leave_policy.sql. Synthetic rows roll back.
begin;
-- Isolate counts from any real tenant data; all setup rolls back below.
update public.employees set status='terminated', termination_date=start_date where status='active';
update public.leave_types set is_active=false;
delete from public.leave_policy_defaults;
do $$ declare actor uuid:=gen_random_uuid(); owner_actor uuid:=gen_random_uuid(); disabled uuid:=gen_random_uuid(); emp uuid; kind uuid; inactive_kind uuid; entry uuid; holiday uuid; holiday_revision timestamptz; begin
  insert into hr_private.account_invites(email,role) values(actor::text||'@example.invalid','hr');
  insert into hr_private.account_invites(email,role) values(owner_actor::text||'@example.invalid','owner');
  insert into hr_private.account_invites(email,role) values(disabled::text||'@example.invalid','hr');
  insert into auth.users(id,email) values(actor,actor::text||'@example.invalid');
  insert into auth.users(id,email) values(owner_actor,owner_actor::text||'@example.invalid');
  insert into auth.users(id,email) values(disabled,disabled::text||'@example.invalid');
  insert into public.app_users(id,role,is_active) values(actor,'hr',true),(owner_actor,'owner',true),(disabled,'hr',false);
  insert into public.employees(employee_code,first_name,last_name,start_date)
    values('P4-'||left(actor::text,8),'Test','Employee','2020-01-01') returning id into emp;
  insert into public.leave_types(name) values('P4 test leave') returning id into kind;
  insert into public.leave_types(name,is_active) values('P4 inactive leave',false) returning id into inactive_kind;
  insert into public.leave_policy_defaults(leave_type_id,year,quota_days) values(kind,2024,0),(kind,2025,0),(kind,2026,1),(kind,2027,1);
  insert into public.leave_policy_defaults(leave_type_id,year,quota_days) values(inactive_kind,2027,4);
  insert into public.leave_entitlements(employee_id,leave_type_id,year,quota_days,source,override_reason)
    values(emp,kind,2024,1,'override','P4 reset floor test'),(emp,kind,2025,0,'policy',null),(emp,kind,2026,1,'policy',null);
  insert into public.leave_entries(employee_id,leave_type_id,start_date,end_date,day_unit,recorded_by)
    values(emp,kind,'2026-02-02','2026-02-02','full',actor) returning id into entry;
  insert into public.leave_entry_days(leave_entry_id,leave_date,days) values(entry,'2026-02-02',1);
  insert into public.leave_entries(employee_id,leave_type_id,start_date,end_date,day_unit,recorded_by)
    values(emp,kind,'2024-02-02','2024-02-02','full',actor) returning id into entry;
  insert into public.leave_entry_days(leave_entry_id,leave_date,days) values(entry,'2024-02-02',1);
  insert into public.holidays(holiday_date,name) values('2026-02-02','P4 test holiday') returning id,updated_at into holiday,holiday_revision;
  perform set_config('hr.p4_actor',actor::text,true);
  perform set_config('hr.p4_owner',owner_actor::text,true);
  perform set_config('hr.p4_disabled',disabled::text,true);
  perform set_config('hr.p4_employee',emp::text,true);
  perform set_config('hr.p4_type',kind::text,true);
  perform set_config('hr.p4_inactive_type',inactive_kind::text,true);
  perform set_config('hr.p4_holiday',holiday::text,true);
  perform set_config('hr.p4_holiday_revision',holiday_revision::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.p4_actor'),'role','authenticated')::text,true);
do $$ declare emp uuid:=current_setting('hr.p4_employee')::uuid; kind uuid:=current_setting('hr.p4_type')::uuid; inactive_kind uuid:=current_setting('hr.p4_inactive_type')::uuid; rev timestamptz; created integer; r public.leave_entitlements; t public.leave_types; holiday public.holidays;
begin
  -- Direct Data API DML is denied even to an active staff member.
  begin insert into public.leave_types(name) values('P4 direct write');
    raise exception using errcode='22000',message='direct policy insert accepted'; exception when insufficient_privilege then null; end;
  begin update public.leave_entitlements set quota_days=99 where employee_id=emp and year=2025;
    raise exception using errcode='22000',message='direct entitlement update accepted'; exception when insufficient_privilege then null; end;
  begin insert into public.leave_entitlements(employee_id,leave_type_id,year,quota_days,source) values(emp,kind,2029,1,'policy');
    raise exception using errcode='22000',message='direct entitlement insert accepted'; exception when insufficient_privilege then null; end;
  begin delete from public.holidays where false;
    raise exception using errcode='22000',message='direct holiday delete accepted'; exception when insufficient_privilege then null; end;
  holiday:=public.save_holiday(current_setting('hr.p4_holiday')::uuid,'2026-02-03','Moved holiday',current_setting('hr.p4_holiday_revision')::timestamptz);
  perform public.delete_holiday(holiday.id,holiday.updated_at);
  if not exists(select 1 from public.leave_entry_days where leave_date='2026-02-02' and days=1) then raise exception 'holiday edit/delete changed recorded leave days'; end if;
  begin perform public.save_leave_type(null,E'\t P4 TEST LEAVE\n',true,3,null);
    raise exception using errcode='22000',message='normalized case/whitespace duplicate accepted'; exception when unique_violation then null; end;
  -- Zero quota and half-day increments are valid; generation is atomic and idempotent.
  created:=public.generate_leave_entitlements(2027);
  if created<>1 then raise exception 'missing policy entitlement was not created'; end if;
  if not exists(select 1 from public.leave_entitlements where employee_id=emp and leave_type_id=kind and year=2027 and quota_days=1 and source='policy') then raise exception 'wrong generated quota'; end if;
  if not exists(select 1 from public.leave_entitlements where employee_id=emp and leave_type_id=kind and year=2026 and quota_days=1 and source='policy') then raise exception 'policy row changed'; end if;
  if exists(select 1 from public.leave_entitlements where employee_id=emp and leave_type_id=inactive_kind and year=2027) then raise exception 'disabled leave type received a new entitlement'; end if;
  if public.generate_leave_entitlements(2027)<>0 then raise exception 'generation not idempotent'; end if;
  if public.copy_leave_policy_defaults(2027,2028)<>2 or public.copy_leave_policy_defaults(2027,2028)<>0 then raise exception 'policy copy was not insert-only/idempotent'; end if;
  select updated_at into rev from public.leave_entitlements where employee_id=emp and leave_type_id=kind and year=2026;
  begin perform public.save_leave_entitlement(emp,kind,2026,0.5,'Test override',rev);
    raise exception using errcode='22000',message='quota below used days accepted'; exception when sqlstate 'P0001' then null; end;
  select updated_at into rev from public.leave_entitlements where employee_id=emp and leave_type_id=kind and year=2026;
  r:=public.save_leave_entitlement(emp,kind,2026,1.5,'Approved test change',rev);
  if r.source<>'override' or r.override_reason<>'Approved test change' or r.quota_days<>1.5 then raise exception 'override not saved'; end if;
  begin perform public.save_leave_entitlement(emp,kind,2026,2,'Stale change',rev);
    raise exception using errcode='22000',message='stale quota update accepted'; exception when sqlstate 'P0001' then null; end;
  select updated_at into rev from public.leave_entitlements where employee_id=emp and leave_type_id=kind and year=2026;
  r:=public.reset_leave_entitlement(emp,kind,2026,rev);
  if r.source<>'policy' or r.quota_days<>1 then raise exception 'reset did not use yearly policy'; end if;
  begin perform public.reset_leave_entitlement(emp,kind,2026,rev);
    raise exception using errcode='22000',message='stale reset accepted'; exception when sqlstate 'P0001' then null; end;
  select updated_at into rev from public.leave_entitlements where employee_id=emp and leave_type_id=kind and year=2024;
  begin perform public.reset_leave_entitlement(emp,kind,2024,rev);
    raise exception using errcode='22000',message='reset below used days accepted'; exception when sqlstate 'P0001' then null; end;
  begin perform public.save_leave_policy_default(null,kind,2026,0.3,null);
    raise exception 'invalid half-day increment accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.save_leave_type(null,'  ',true,0,null);
    raise exception 'blank leave type accepted'; exception when sqlstate '22023' then null; end;
  t:=public.save_leave_type(null,'P4 missing policy',true,2,null);
  begin perform public.generate_leave_entitlements(2028);
    raise exception using errcode='22000',message='generation accepted missing standard quota';
    exception when sqlstate 'P0001' then null; end;
  if exists(select 1 from public.leave_entitlements where employee_id=emp and year=2028) then raise exception 'generation partially inserted entitlements'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.p4_owner'),'role','authenticated')::text,true);
do $$ begin
  perform public.save_leave_type(null,'P4 owner write',true,50,null);
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.p4_disabled'),'role','authenticated')::text,true);
do $$ begin
  begin perform public.generate_leave_entitlements(9999);
    raise exception using errcode='22000',message='disabled user invoked no-op generation'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform public.generate_leave_entitlements(9999);
    raise exception using errcode='22000',message='anonymous generation RPC accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: zero and half-day quotas; annual generation idempotency; no policy overwrite; used-day floor; override reason/source; stale revision rejection; reset to that year policy; invalid value rejection' as result;
rollback;
