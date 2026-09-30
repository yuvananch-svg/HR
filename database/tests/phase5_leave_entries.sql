-- Run as database administrator after Phase 5 migrations are applied.
-- All fixtures and mutations roll back at the end of this file.
begin;
do $$
declare
  actor uuid := gen_random_uuid();
  owner_actor uuid := gen_random_uuid();
  disabled_actor uuid := gen_random_uuid();
  uninvited_actor uuid := gen_random_uuid();
  employee uuid;
  leave_type uuid;
  test_year integer := 2096;
  monday date;
  holiday date;
begin
  insert into hr_private.account_invites(email,role) values(actor::text||'@example.invalid','hr');
  insert into hr_private.account_invites(email,role) values(owner_actor::text||'@example.invalid','owner');
  insert into hr_private.account_invites(email,role) values(disabled_actor::text||'@example.invalid','hr');
  insert into auth.users(id,email) values(actor,actor::text||'@example.invalid');
  insert into auth.users(id,email) values(owner_actor,owner_actor::text||'@example.invalid');
  insert into auth.users(id,email) values(disabled_actor,disabled_actor::text||'@example.invalid');
  insert into public.app_users(id,role,is_active,display_name) values
    (actor,'hr',true,'Phase 5 regression'),(owner_actor,'owner',true,'Phase 5 owner regression'),
    (disabled_actor,'hr',false,'Phase 5 disabled regression');
  insert into public.employees(employee_code,first_name,last_name,start_date)
    values('P5-'||left(actor::text,8),'Phase','Five','2020-01-01') returning id into employee;
  insert into public.leave_types(name) values('P5 regression '||left(actor::text,8)) returning id into leave_type;
  insert into public.leave_policy_defaults(leave_type_id,year,quota_days) values(leave_type,test_year,3.5);
  insert into public.leave_entitlements(employee_id,leave_type_id,year,quota_days,source)
    values(employee,leave_type,test_year,3.5,'policy');
  insert into public.leave_policy_defaults(leave_type_id,year,quota_days) values(leave_type,test_year+1,3.5);
  insert into public.leave_entitlements(employee_id,leave_type_id,year,quota_days,source)
    values(employee,leave_type,test_year+1,3.5,'policy');
  monday := make_date(test_year,1,1) + mod(8-extract(isodow from make_date(test_year,1,1))::integer,7);
  holiday := monday + 1;
  insert into public.holidays(holiday_date,name) values(holiday,'P5 regression holiday');
  perform set_config('hr.p5_actor',actor::text,true);
  perform set_config('hr.p5_owner_actor',owner_actor::text,true);
  perform set_config('hr.p5_disabled_actor',disabled_actor::text,true);
  perform set_config('hr.p5_uninvited_actor',uninvited_actor::text,true);
  perform set_config('hr.p5_employee',employee::text,true);
  perform set_config('hr.p5_type',leave_type::text,true);
  perform set_config('hr.p5_monday',monday::text,true);
  perform set_config('hr.p5_holiday',holiday::text,true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.p5_actor'),'role','authenticated')::text,true);
do $$
declare
  employee uuid := current_setting('hr.p5_employee')::uuid;
  leave_type uuid := current_setting('hr.p5_type')::uuid;
  monday date := current_setting('hr.p5_monday')::date;
  holiday date := current_setting('hr.p5_holiday')::date;
  year_end_workday date := make_date(2096,12,31);
  p jsonb;
  morning_preview jsonb;
  full_preview jsonb;
  morning_entry uuid;
  afternoon_entry uuid;
  revision timestamptz;
  key uuid := gen_random_uuid();
  created_entry uuid;
  stale_key uuid := gen_random_uuid();
  audit_count integer;
  audit_before integer;
  message text;
begin
  -- Preview counts a holiday as zero, while preserving weekdays around it.
  p := public.preview_leave_entry(employee,leave_type,monday,monday+2,'full',null);
  if (select count(*) from jsonb_array_elements(p->'days') d where (d->>'days')::numeric=1)<>2 then
    raise exception 'holiday calculation did not count two working days';
  end if;
  if not exists(select 1 from jsonb_array_elements(p->'days') d where (d->>'leave_date')::date=holiday and (d->>'reason')='holiday' and (d->>'days')::numeric=0) then
    raise exception 'holiday was not represented as a skipped day';
  end if;
  p := public.preview_leave_entry(employee,leave_type,monday+4,monday+6,'full',null);
  if (select count(*) from jsonb_array_elements(p->'days') d where (d->>'days')::numeric=1)<>1
    or (select count(*) from jsonb_array_elements(p->'days') d where (d->>'reason')='weekend' and (d->>'days')::numeric=0)<>2 then
    raise exception 'weekend was not skipped in full-day preview';
  end if;
  begin
    perform public.preview_leave_entry(employee,leave_type,monday+5,monday+5,'morning',null);
    raise exception using errcode='22000',message='half-day on a weekend was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics message=message_text;
    if message<>'no_working_days' then raise exception using errcode='22000',message='expected no_working_days, got '||message; end if;
  end;
  while extract(isodow from year_end_workday) in (6,7) loop year_end_workday:=year_end_workday-1; end loop;
  p := public.preview_leave_entry(employee,leave_type,year_end_workday,year_end_workday+3,'full',null);
  if jsonb_array_length(p->'balances')<>2
    or not exists(select 1 from jsonb_array_elements(p->'balances') b where (b->>'year')::int=2096 and (b->>'requested_days')::numeric>0)
    or not exists(select 1 from jsonb_array_elements(p->'balances') b where (b->>'year')::int=2097 and (b->>'requested_days')::numeric>0) then
    raise exception 'cross-year preview did not split charged days by quota year';
  end if;

  -- A half day is 0.5; opposite halves may coexist on the same date.
  morning_preview := public.preview_leave_entry(employee,leave_type,monday,monday,'morning',null);
  full_preview := public.preview_leave_entry(employee,leave_type,monday,monday,'full',null);
  morning_entry := public.save_leave_entry(key,employee,leave_type,monday,monday,'morning','morning test',morning_preview->>'fingerprint',null,null,null);
  p := public.preview_leave_entry(employee,leave_type,monday,monday,'afternoon',null);
  afternoon_entry := public.save_leave_entry(gen_random_uuid(),employee,leave_type,monday,monday,'afternoon','afternoon test',p->>'fingerprint',null,null,null);
  if (select sum(days) from public.leave_entry_days where leave_entry_id in (morning_entry,afternoon_entry))<>1 then
    raise exception 'morning and afternoon did not total one day';
  end if;

  -- Same-half and full-day collisions are rejected without partial writes.
  begin
    perform public.save_leave_entry(gen_random_uuid(),employee,leave_type,monday,monday,'morning','duplicate',morning_preview->>'fingerprint',null,null,null);
    raise exception using errcode='22000',message='duplicate half-day was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics message=message_text;
    if message<>'overlap_conflict' then raise exception using errcode='22000',message='expected overlap_conflict, got '||message; end if;
  end;
  begin
    perform public.save_leave_entry(gen_random_uuid(),employee,leave_type,monday,monday,'full','full overlap',full_preview->>'fingerprint',null,null,null);
    raise exception using errcode='22000',message='full-day overlap was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics message=message_text;
    if message<>'overlap_conflict' then raise exception using errcode='22000',message='expected overlap_conflict, got '||message; end if;
  end;

  -- Save retries are idempotent; a request key reused with a different payload fails.
  p := public.preview_leave_entry(employee,leave_type,monday+3,monday+3,'full',null);
  key := gen_random_uuid();
  created_entry := public.save_leave_entry(key,employee,leave_type,monday+3,monday+3,'full','retry test',p->>'fingerprint',null,null,null);
  if public.save_leave_entry(key,employee,leave_type,monday+3,monday+3,'full','retry test',p->>'fingerprint',null,null,null)<>created_entry then
    raise exception 'same save request did not return the original entry';
  end if;
  begin
    perform public.save_leave_entry(key,employee,leave_type,monday+4,monday+4,'full','different payload',p->>'fingerprint',null,null,null);
    raise exception using errcode='22000',message='changed payload reused a request key';
  exception when sqlstate 'P0001' then
    get stacked diagnostics message=message_text;
    if message<>'request_key_conflict' then raise exception using errcode='22000',message='expected request_key_conflict, got '||message; end if;
  end;

  -- A stale preview is rejected; the failed save leaves entry, days, and audit unchanged.
  p := public.preview_leave_entry(employee,leave_type,monday+8,monday+8,'full',null);
  select count(*) into audit_before from public.audit_events;
  perform set_config('hr.p5_stale_key',stale_key::text,true);
  begin
    perform public.save_leave_entry(stale_key,employee,leave_type,monday+8,monday+8,'full','stale preview','not-the-preview-fingerprint',null,null,null);
    raise exception using errcode='22000',message='stale preview was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics message=message_text;
    if message<>'preview_changed' then raise exception using errcode='22000',message='expected preview_changed, got '||message; end if;
  end;
  if exists(select 1 from public.leave_entries where employee_id=employee and start_date=monday+8)
    or (select count(*) from public.audit_events)<>audit_before then
    raise exception 'stale preview left partial mutation';
  end if;

  -- Edit checks revision and replaces days atomically; stale revision cannot change history.
  select updated_at into revision from public.leave_entries where id=afternoon_entry;
  p := public.preview_leave_entry(employee,leave_type,monday+2,monday+2,'full',afternoon_entry);
  perform public.save_leave_entry(gen_random_uuid(),employee,leave_type,monday+2,monday+2,'full','edited',p->>'fingerprint',afternoon_entry,revision,'edit test');
  if not exists(select 1 from public.leave_entry_days where leave_entry_id=afternoon_entry and leave_date=monday+2 and days=1)
    or exists(select 1 from public.leave_entry_days where leave_entry_id=afternoon_entry and leave_date=monday) then
    raise exception 'edit did not replace the original day atomically';
  end if;
  select updated_at into revision from public.leave_entries where id=afternoon_entry;
  select count(*) into audit_count from public.audit_events where record_id=afternoon_entry;
  p := public.preview_leave_entry(employee,leave_type,monday+8,monday+8,'full',afternoon_entry);
  begin
    perform public.save_leave_entry(gen_random_uuid(),employee,leave_type,monday+8,monday+8,'full','stale edit',p->>'fingerprint',afternoon_entry,revision-interval '1 day','stale edit test');
    raise exception using errcode='22000',message='stale revision was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics message=message_text;
    if message<>'revision_conflict' then raise exception using errcode='22000',message='expected revision_conflict, got '||message; end if;
  end;
  if (select count(*) from public.audit_events where record_id=afternoon_entry)<>audit_count
    or not exists(select 1 from public.leave_entry_days where leave_entry_id=afternoon_entry and leave_date=monday+2 and days=1) then
    raise exception 'stale edit changed days or audit';
  end if;

  -- A request that fits exactly at the remaining quota previews; a larger range fails.
  p := public.preview_leave_entry(employee,leave_type,monday+9,monday+9,'full',null);
  if (p->'balances'->0->>'remaining_after')::numeric<>0 then raise exception 'exact-quota preview did not reach zero'; end if;
  begin
    perform public.preview_leave_entry(employee,leave_type,monday+7,monday+8,'full',null);
    raise exception using errcode='22000',message='request exceeding the remaining quota was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics message=message_text;
    if message<>'quota_exceeded' then raise exception using errcode='22000',message='expected quota_exceeded, got '||message; end if;
  end;

  -- Cancellation returns the same result on retry, preserves original days, and writes one audit event.
  select updated_at into revision from public.leave_entries where id=morning_entry;
  key := gen_random_uuid();
  perform public.cancel_leave_entry(morning_entry,revision,'cancel test',key);
  perform public.cancel_leave_entry(morning_entry,revision,'cancel test',key);
  if (select status from public.leave_entries where id=morning_entry)<>'cancelled'
    or not exists(select 1 from public.leave_entry_days where leave_entry_id=morning_entry and leave_date=monday and days=0.5)
    or (select count(*) from public.audit_events where record_id=morning_entry)<>2 then
    raise exception 'cancel retry duplicated audit or removed historical days';
  end if;
  begin
    perform public.cancel_leave_entry(morning_entry,revision,'second cancellation',gen_random_uuid());
    raise exception using errcode='22000',message='a second cancellation with a new key was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics message=message_text;
    if message<>'entry_cancelled' then raise exception using errcode='22000',message='expected entry_cancelled, got '||message; end if;
  end;

  -- RPC-only writes and staff checks: authenticated direct table DML is denied.
  begin
    update public.leave_entries set reason='forged' where id=afternoon_entry;
    raise exception using errcode='22000',message='direct leave-entry update was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.leave_entry_days set days=0.5 where leave_entry_id=afternoon_entry;
    raise exception using errcode='22000',message='direct leave-day update was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.audit_events set reason='forged' where record_id=afternoon_entry;
    raise exception using errcode='22000',message='direct audit update was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
-- The owner uses the same preview/save RPC successfully as active HR.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.p5_owner_actor'),'role','authenticated')::text,true);
do $$ declare p jsonb; saved uuid;
begin
  p:=public.preview_leave_entry(current_setting('hr.p5_employee')::uuid,current_setting('hr.p5_type')::uuid,
    current_setting('hr.p5_monday')::date+10,current_setting('hr.p5_monday')::date+10,'full',null);
  saved:=public.save_leave_entry(gen_random_uuid(),current_setting('hr.p5_employee')::uuid,current_setting('hr.p5_type')::uuid,
    current_setting('hr.p5_monday')::date+10,current_setting('hr.p5_monday')::date+10,'full','owner access test',p->>'fingerprint',null,null,null);
  if not exists(select 1 from public.leave_entries where id=saved and recorded_by=current_setting('hr.p5_owner_actor')::uuid) then
    raise exception 'active owner did not record the entry as actor';
  end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
  begin
    perform public.preview_leave_entry(current_setting('hr.p5_employee')::uuid,current_setting('hr.p5_type')::uuid,current_setting('hr.p5_monday')::date,current_setting('hr.p5_monday')::date,'full',null);
    raise exception using errcode='22000',message='anonymous preview was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.p5_uninvited_actor'),'role','authenticated')::text,true);
do $$ begin
  begin
    perform public.preview_leave_entry(current_setting('hr.p5_employee')::uuid,current_setting('hr.p5_type')::uuid,current_setting('hr.p5_monday')::date,current_setting('hr.p5_monday')::date,'full',null);
    raise exception using errcode='22000',message='uninvited user preview was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.p5_disabled_actor'),'role','authenticated')::text,true);
do $$ begin
  begin
    perform public.preview_leave_entry(current_setting('hr.p5_employee')::uuid,current_setting('hr.p5_type')::uuid,current_setting('hr.p5_monday')::date,current_setting('hr.p5_monday')::date,'full',null);
    raise exception using errcode='22000',message='disabled staff preview was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.leave_entry_requests
      where actor_id=current_setting('hr.p5_actor')::uuid and request_key=current_setting('hr.p5_stale_key')::uuid) then
    raise exception 'stale-preview failure left a request-ledger row';
  end if;
end $$;
select 'PASS: preview/quotas/overlaps/idempotency/revisions/audit; active owner and HR access; anon/disabled/uninvited denial; direct leave/day/audit writes denied' as result;
rollback;
