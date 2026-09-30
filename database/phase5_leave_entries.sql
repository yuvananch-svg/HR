-- Phase 5 atomic leave-entry RPCs. Apply after phase4_leave_policy.sql.

create table public.leave_entry_requests (
 actor_id uuid not null references public.app_users(id) on delete restrict,
 request_key uuid not null, operation text not null check(operation in ('save','cancel')),
 payload_fingerprint text not null, entry_id uuid not null references public.leave_entries(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(actor_id,request_key)
);
alter table public.leave_entry_requests enable row level security;
revoke all on public.leave_entry_requests from public,anon,authenticated;

-- Serialize holiday edits against preview/save snapshots. Phase 4 holiday RPCs
-- automatically take the exclusive side through this trigger.
create or replace function hr_private.lock_leave_calendar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leave-calendar',0));
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function hr_private.lock_leave_calendar() from public,anon,authenticated;
create trigger lock_leave_calendar before insert or update or delete on public.holidays
 for each row execute function hr_private.lock_leave_calendar();

create or replace function hr_private.leave_entry_preview_impl(
 p_employee_id uuid,p_leave_type_id uuid,p_start_date date,p_end_date date,p_unit text,p_entry_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare emp public.employees; typ public.leave_types; r record; days_json jsonb:='[]'::jsonb; balances jsonb; released jsonb:='[]'::jsonb; fp text;
begin
 perform hr_private.assert_active_staff();
 if p_start_date is not null and p_end_date is not null and p_end_date-p_start_date>3660 then
  raise exception using errcode='22023',message='leave_range_too_long'; end if;
 if p_employee_id is null or p_leave_type_id is null or p_start_date is null or p_end_date is null
   or p_start_date<make_date(1900,1,1) or p_end_date>date '9999-12-31'
   or p_end_date<p_start_date or p_unit is null or p_unit not in ('full','morning','afternoon')
   or (p_unit<>'full' and p_start_date<>p_end_date) or p_end_date-p_start_date>3660 then
  raise exception using errcode='22023',message='invalid_leave_entry'; end if;
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-calendar',0));
 select * into emp from public.employees where id=p_employee_id;
 if not found then raise exception using errcode='P0002',message='employee_not_found'; end if;
 select * into typ from public.leave_types where id=p_leave_type_id;
 if not found then raise exception using errcode='P0002',message='leave_type_not_found'; end if;
 if p_entry_id is not null and not exists(select 1 from public.leave_entries e where e.id=p_entry_id and e.status='recorded' and e.employee_id=p_employee_id) then
  raise exception using errcode='P0001',message='entry_not_found'; end if;
 if emp.status='terminated' and (p_end_date>(now() at time zone 'Asia/Bangkok')::date or p_start_date<emp.start_date or emp.termination_date is null or p_end_date>emp.termination_date) then
  raise exception using errcode='P0001',message='outside_employment'; end if;
 if emp.status='active' and (p_start_date<emp.start_date or (emp.termination_date is not null and p_end_date>emp.termination_date)) then
  raise exception using errcode='P0001',message='outside_employment'; end if;
 if not typ.is_active and p_end_date>(now() at time zone 'Asia/Bangkok')::date then
  raise exception using errcode='P0001',message='inactive_type_future_date'; end if;
 if p_unit<>'full' then
  if extract(isodow from p_start_date) not between 1 and 5 or exists(select 1 from public.holidays where holiday_date=p_start_date) then
   raise exception using errcode='P0001',message='no_working_days'; end if;
  days_json:=jsonb_build_array(jsonb_build_object('leave_date',p_start_date,'days',0.5,'half_period',p_unit,'counts',true,'reason','half_day'));
 else
  for r in select d::date dt,(extract(isodow from d)::integer between 1 and 5 and not exists(select 1 from public.holidays h where h.holiday_date=d::date)) counts
   from generate_series(p_start_date::timestamp,p_end_date::timestamp,interval '1 day') d order by d loop
   days_json:=days_json||jsonb_build_array(jsonb_build_object('leave_date',r.dt,'days',case when r.counts then 1 else 0 end,
    'half_period',null,'counts',r.counts,'reason',case when r.counts then 'working_day' when extract(isodow from r.dt) in (6,7) then 'weekend' else 'holiday' end));
  end loop;
 end if;
 if not exists(select 1 from jsonb_array_elements(days_json) x where (x->>'days')::numeric>0) then
  raise exception using errcode='P0001',message='no_working_days'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('year',q.quota_year,'quota_days',q.quota,'used_before',q.used,
  'requested_days',q.requested,'used_after',q.used+q.requested,'remaining_after',q.quota-q.used-q.requested) order by q.quota_year),'[]'::jsonb)
 into balances from (
  select requested.quota_year,le.quota_days quota,coalesce(used.used_days,0) used,requested.requested_days requested
  from (select extract(year from (x->>'leave_date')::date)::int as quota_year,sum((x->>'days')::numeric) requested_days
    from jsonb_array_elements(days_json) x where (x->>'days')::numeric>0
    group by extract(year from (x->>'leave_date')::date)::int) requested
  join public.leave_entitlements le on le.employee_id=p_employee_id and le.leave_type_id=p_leave_type_id and le.year=requested.quota_year
  left join lateral (select sum(d.days) used_days from public.leave_entry_days d join public.leave_entries e on e.id=d.leave_entry_id
    where e.employee_id=p_employee_id and e.leave_type_id=p_leave_type_id and e.status='recorded'
     and extract(year from d.leave_date)::int=requested.quota_year and e.id is distinct from p_entry_id) used on true
 ) q;
 if (select count(distinct extract(year from (x->>'leave_date')::date)::int) from jsonb_array_elements(days_json) x where (x->>'days')::numeric>0)<>jsonb_array_length(balances) then
  raise exception using errcode='P0002',message='missing_entitlement'; end if;
 if exists(select 1 from jsonb_array_elements(balances) b where (b->>'remaining_after')::numeric<0) then
  raise exception using errcode='P0001',message='quota_exceeded'; end if;
 if exists(select 1 from jsonb_array_elements(days_json) x join public.leave_entry_days d on d.leave_date=(x->>'leave_date')::date
  join public.leave_entries e on e.id=d.leave_entry_id where (x->>'days')::numeric>0 and e.employee_id=p_employee_id
  and e.status='recorded' and e.id is distinct from p_entry_id and ((x->>'days')::numeric=1 or d.days=1 or d.half_period=x->>'half_period')) then
  raise exception using errcode='P0001',message='overlap_conflict'; end if;
 if p_entry_id is not null then
  select coalesce(jsonb_agg(jsonb_build_object('leave_type_id',z.leave_type_id,'year',z.quota_year,'quota_days',z.quota,
   'used_before',z.used,'requested_days',-z.release_days,'used_after',z.used-z.release_days,'remaining_after',z.quota-z.used+z.release_days) order by z.quota_year,z.leave_type_id),'[]'::jsonb)
   into released from (
    select old_days.leave_type_id,old_days.quota_year,le.quota_days quota,used.used_days used,old_days.release_days
    from (select e.leave_type_id,extract(year from d.leave_date)::int as quota_year,sum(d.days) release_days
      from public.leave_entry_days d join public.leave_entries e on e.id=d.leave_entry_id
      where e.id=p_entry_id and e.status='recorded' and (e.leave_type_id<>p_leave_type_id or extract(year from d.leave_date)::int not in
       (select distinct extract(year from (x->>'leave_date')::date)::int from jsonb_array_elements(days_json) x where (x->>'days')::numeric>0))
      group by e.leave_type_id,extract(year from d.leave_date)::int) old_days
    join public.leave_entitlements le on le.employee_id=p_employee_id and le.leave_type_id=old_days.leave_type_id and le.year=old_days.quota_year
    left join lateral (select sum(d2.days) used_days from public.leave_entry_days d2 join public.leave_entries e2 on e2.id=d2.leave_entry_id
      where e2.employee_id=p_employee_id and e2.leave_type_id=old_days.leave_type_id and e2.status='recorded'
       and extract(year from d2.leave_date)::int=old_days.quota_year) used on true
   ) z;
 end if;
 fp:=md5(jsonb_build_object('employee',p_employee_id,'type',p_leave_type_id,'start',p_start_date,'end',p_end_date,'unit',p_unit,
  'entry',p_entry_id,'days',days_json,'balances',balances,'released_balances',released,'type_active',typ.is_active,'employee_status',emp.status,
  'employee_start',emp.start_date,'termination',emp.termination_date,
  'holidays',(select coalesce(jsonb_agg(holiday_date order by holiday_date),'[]'::jsonb) from public.holidays where holiday_date between p_start_date and p_end_date))::text);
 return jsonb_build_object('days',days_json,'balances',balances,'released_balances',released,'fingerprint',fp);
end $$;

create or replace function hr_private.save_leave_entry_impl(
 p_request_key uuid,p_employee_id uuid,p_leave_type_id uuid,p_start_date date,p_end_date date,p_unit text,p_reason text,
 p_preview_fingerprint text,p_entry_id uuid default null,p_expected_revision timestamptz default null,p_change_reason text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid; preview jsonb; payload text; saved public.leave_entries; oldjson jsonb; newjson jsonb; years int[]; yr int; emp public.employees; typ public.leave_types; lockrow record; existing public.leave_entries;
begin
 perform hr_private.assert_active_staff(); actor:=auth.uid();
 if p_start_date is not null and p_end_date is not null and p_end_date-p_start_date>3660 then raise exception using errcode='22023',message='leave_range_too_long'; end if;
 if p_start_date is null or p_end_date is null or p_start_date<make_date(1900,1,1) or p_end_date>date '9999-12-31'
  or p_end_date<p_start_date or p_end_date-p_start_date>3660 or p_unit is null or p_unit not in ('full','morning','afternoon')
  or p_employee_id is null or p_leave_type_id is null or p_request_key is null or length(btrim(coalesce(p_reason,''),E' \t\n\r\f'))>500
  or (p_entry_id is not null and (p_expected_revision is null or nullif(btrim(coalesce(p_change_reason,''),E' \t\n\r\f'),'') is null or length(btrim(p_change_reason,E' \t\n\r\f'))>500)) then
  raise exception using errcode='22023',message='invalid_leave_entry'; end if;
 -- Request key is the first serialization point so a retry remains idempotent
 -- after the entry has subsequently been changed or cancelled.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_request_key::text,0));
 payload:=md5(jsonb_build_array('save',p_employee_id,p_leave_type_id,p_start_date,p_end_date,p_unit,p_reason,p_entry_id,p_expected_revision,p_change_reason,p_preview_fingerprint)::text);
 if exists(select 1 from public.leave_entry_requests where actor_id=actor and request_key=p_request_key) then
  if not exists(select 1 from public.leave_entry_requests where actor_id=actor and request_key=p_request_key and operation='save' and payload_fingerprint=payload) then raise exception using errcode='P0001',message='request_key_conflict'; end if;
  return (select entry_id from public.leave_entry_requests where actor_id=actor and request_key=p_request_key);
 end if;
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-types-config',0));
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-calendar',0));
 if p_entry_id is not null then select * into existing from public.leave_entries where id=p_entry_id and status='recorded';
  if not found then raise exception using errcode='P0002',message='entry_not_found'; end if;
  if existing.employee_id<>p_employee_id then raise exception using errcode='P0001',message='employee_change_not_allowed'; end if;
 end if;
 select array_agg(y order by y) into years from (select distinct y from (
  select extract(year from d)::int y from generate_series(p_start_date::timestamp,p_end_date::timestamp,interval '1 day') d
  union select extract(year from d.leave_date)::int from public.leave_entry_days d where d.leave_entry_id=p_entry_id
 ) all_years) s;
 foreach yr in array coalesce(years,'{}'::int[]) loop perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-policy-year:'||yr::text,0)); end loop;
 select * into emp from public.employees where id=p_employee_id for share;
 if not found then raise exception using errcode='P0002',message='employee_not_found'; end if;
 select * into typ from public.leave_types where id=p_leave_type_id for share;
 if not found then raise exception using errcode='P0002',message='leave_type_not_found'; end if;
 for lockrow in select distinct t_id,y from (
  select p_leave_type_id t_id,unnest(coalesce(years,'{}'::int[])) y
  union select existing.leave_type_id,extract(year from d.leave_date)::int from public.leave_entry_days d where p_entry_id is not null and d.leave_entry_id=p_entry_id
 ) k order by t_id,y loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee_id::text||':'||lockrow.t_id::text||':'||lockrow.y::text,0));
 end loop;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leave-overlap:'||p_employee_id::text,0));
 if p_entry_id is not null then
  select * into existing from public.leave_entries where id=p_entry_id and status='recorded' for update;
  if not found then raise exception using errcode='P0002',message='entry_not_found'; end if;
  if existing.employee_id<>p_employee_id then raise exception using errcode='P0001',message='employee_change_not_allowed'; end if;
  if existing.updated_at is distinct from p_expected_revision then raise exception using errcode='P0001',message='revision_conflict'; end if;
 end if;
 if (emp.status<>'active' or not typ.is_active) and nullif(btrim(p_reason,E' \t\n\r\f'),'') is null then raise exception using errcode='P0001',message='inactive_reason_required'; end if;
 if emp.status='terminated' and (p_end_date>(now() at time zone 'Asia/Bangkok')::date or p_start_date<emp.start_date or emp.termination_date is null or p_end_date>emp.termination_date) then raise exception using errcode='P0001',message='outside_employment'; end if;
 if emp.status='active' and (p_start_date<emp.start_date or (emp.termination_date is not null and p_end_date>emp.termination_date)) then raise exception using errcode='P0001',message='outside_employment'; end if;
 if not typ.is_active and p_end_date>(now() at time zone 'Asia/Bangkok')::date then raise exception using errcode='P0001',message='inactive_type_future_date'; end if;
 preview:=hr_private.leave_entry_preview_impl(p_employee_id,p_leave_type_id,p_start_date,p_end_date,p_unit,p_entry_id);
 if preview->>'fingerprint' is distinct from p_preview_fingerprint then raise exception using errcode='P0001',message='preview_changed'; end if;
 if p_entry_id is null then
  insert into public.leave_entries(employee_id,leave_type_id,start_date,end_date,day_unit,half_period,reason,recorded_by)
   values(p_employee_id,p_leave_type_id,p_start_date,p_end_date,case when p_unit='full' then 'full' else 'half' end,case when p_unit='full' then null else p_unit end,btrim(p_reason,E' \t\n\r\f'),actor) returning * into saved;
 else
  select to_jsonb(e)||jsonb_build_object('days',coalesce((select jsonb_agg(jsonb_build_object('leave_date',d.leave_date,'days',d.days,'half_period',d.half_period) order by d.leave_date) from public.leave_entry_days d where d.leave_entry_id=e.id),'[]'::jsonb)) into oldjson
   from public.leave_entries e where e.id=p_entry_id and e.status='recorded' for update;
  if not found then raise exception using errcode='P0002',message='entry_not_found'; end if;
  if (oldjson->>'updated_at')::timestamptz is distinct from p_expected_revision then raise exception using errcode='P0001',message='revision_conflict'; end if;
  update public.leave_entries set employee_id=p_employee_id,leave_type_id=p_leave_type_id,start_date=p_start_date,end_date=p_end_date,
   day_unit=case when p_unit='full' then 'full' else 'half' end,half_period=case when p_unit='full' then null else p_unit end,
   reason=btrim(p_reason,E' \t\n\r\f'),updated_by=actor,change_reason=btrim(p_change_reason,E' \t\n\r\f') where id=p_entry_id returning * into saved;
  delete from public.leave_entry_days where leave_entry_id=p_entry_id;
 end if;
 insert into public.leave_entry_days(leave_entry_id,leave_date,days,half_period) select saved.id,(x->>'leave_date')::date,(x->>'days')::numeric,nullif(x->>'half_period','') from jsonb_array_elements(preview->'days') x where (x->>'days')::numeric>0;
 newjson:=to_jsonb(saved)||jsonb_build_object('days',coalesce((select jsonb_agg(jsonb_build_object('leave_date',d.leave_date,'days',d.days,'half_period',d.half_period) order by d.leave_date) from public.leave_entry_days d where d.leave_entry_id=saved.id),'[]'::jsonb),
  'actor_snapshot',(select jsonb_build_object('id',u.id,'display_name',u.display_name,'role',u.role) from public.app_users u where u.id=actor));
 if oldjson is not null then oldjson:=oldjson||jsonb_build_object('actor_snapshot',(select jsonb_build_object('id',u.id,'display_name',u.display_name,'role',u.role) from public.app_users u where u.id=actor)); end if;
 insert into public.audit_events(actor_id,table_name,record_id,action,changed_fields,reason,before_values,after_values)
  values(actor,'leave_entries',saved.id,case when oldjson is null then 'INSERT' else 'UPDATE' end,
   case when oldjson is null then array['employee_id','leave_type_id','start_date','end_date','day_unit','half_period','reason','days'] else
    array(select k from unnest(array['employee_id','leave_type_id','start_date','end_date','day_unit','half_period','reason','change_reason','updated_by','updated_at','days']) k where oldjson->k is distinct from newjson->k) end,
   case when oldjson is null then btrim(p_reason,E' \t\n\r\f') else btrim(p_change_reason,E' \t\n\r\f') end,oldjson,newjson);
 insert into public.leave_entry_requests(actor_id,request_key,operation,payload_fingerprint,entry_id) values(actor,p_request_key,'save',payload,saved.id);
 return saved.id;
end $$;

create or replace function hr_private.cancel_leave_entry_impl(p_entry_id uuid,p_expected_revision timestamptz,p_reason text,p_request_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid; e public.leave_entries; payload text; oldjson jsonb; newjson jsonb; lockrow record;
begin
 perform hr_private.assert_active_staff(); actor:=auth.uid();
 if p_entry_id is null or p_expected_revision is null or p_request_key is null or nullif(btrim(coalesce(p_reason,''),E' \t\n\r\f'),'') is null or length(btrim(p_reason,E' \t\n\r\f'))>500 then raise exception using errcode='22023',message='invalid_leave_entry'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_request_key::text,0));
 payload:=md5(jsonb_build_array('cancel',p_entry_id,p_expected_revision,p_reason)::text);
 if exists(select 1 from public.leave_entry_requests where actor_id=actor and request_key=p_request_key) then
  if not exists(select 1 from public.leave_entry_requests where actor_id=actor and request_key=p_request_key and operation='cancel' and payload_fingerprint=payload) then raise exception using errcode='P0001',message='request_key_conflict'; end if; return p_entry_id; end if;
 select * into e from public.leave_entries where id=p_entry_id;
 if not found then raise exception using errcode='P0002',message='entry_not_found'; end if;
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-types-config',0));
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-calendar',0));
 for lockrow in select distinct extract(year from d.leave_date)::int y from public.leave_entry_days d where d.leave_entry_id=p_entry_id order by 1 loop
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-policy-year:'||lockrow.y::text,0));
 end loop;
 for lockrow in select distinct le.employee_id,le.leave_type_id,extract(year from d.leave_date)::int y from public.leave_entry_days d join public.leave_entries le on le.id=d.leave_entry_id where d.leave_entry_id=p_entry_id order by le.employee_id,le.leave_type_id,3 loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lockrow.employee_id::text||':'||lockrow.leave_type_id::text||':'||lockrow.y::text,0));
 end loop;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leave-overlap:'||e.employee_id::text,0));
 select * into e from public.leave_entries where id=p_entry_id for update;
 if not found then raise exception using errcode='P0002',message='entry_not_found'; end if;
 if e.status<>'recorded' then raise exception using errcode='P0001',message='entry_cancelled'; end if;
 if e.updated_at is distinct from p_expected_revision then raise exception using errcode='P0001',message='revision_conflict'; end if;
 oldjson:=to_jsonb(e)||jsonb_build_object('days',(select coalesce(jsonb_agg(jsonb_build_object('leave_date',d.leave_date,'days',d.days,'half_period',d.half_period) order by d.leave_date),'[]'::jsonb) from public.leave_entry_days d where d.leave_entry_id=e.id),
  'actor_snapshot',(select jsonb_build_object('id',u.id,'display_name',u.display_name,'role',u.role) from public.app_users u where u.id=actor));
 update public.leave_entries set status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=actor,updated_by=actor,change_reason=btrim(p_reason,E' \t\n\r\f') where id=p_entry_id returning * into e;
 newjson:=to_jsonb(e)||jsonb_build_object('days',oldjson->'days','actor_snapshot',oldjson->'actor_snapshot');
 insert into public.audit_events(actor_id,table_name,record_id,action,changed_fields,reason,before_values,after_values)
  values(actor,'leave_entries',p_entry_id,'UPDATE',array(select k from unnest(array['status','cancelled_at','cancelled_by','updated_by','updated_at','change_reason']) k where oldjson->k is distinct from newjson->k),btrim(p_reason,E' \t\n\r\f'),oldjson,newjson);
 insert into public.leave_entry_requests(actor_id,request_key,operation,payload_fingerprint,entry_id) values(actor,p_request_key,'cancel',payload,p_entry_id);
 return p_entry_id;
end $$;

create or replace function public.preview_leave_entry(p_employee_id uuid,p_leave_type_id uuid,p_start_date date,p_end_date date,p_unit text,p_entry_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$ begin return hr_private.leave_entry_preview_impl(p_employee_id,p_leave_type_id,p_start_date,p_end_date,p_unit,p_entry_id); end $$;
create or replace function public.save_leave_entry(p_request_key uuid,p_employee_id uuid,p_leave_type_id uuid,p_start_date date,p_end_date date,p_unit text,p_reason text,p_preview_fingerprint text,p_entry_id uuid default null,p_expected_revision timestamptz default null,p_change_reason text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$ begin return hr_private.save_leave_entry_impl(p_request_key,p_employee_id,p_leave_type_id,p_start_date,p_end_date,p_unit,p_reason,p_preview_fingerprint,p_entry_id,p_expected_revision,p_change_reason); end $$;
create or replace function public.cancel_leave_entry(p_entry_id uuid,p_expected_revision timestamptz,p_reason text,p_request_key uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$ begin return hr_private.cancel_leave_entry_impl(p_entry_id,p_expected_revision,p_reason,p_request_key); end $$;

revoke all on function hr_private.leave_entry_preview_impl(uuid,uuid,date,date,text,uuid) from public,anon,authenticated;
revoke all on function hr_private.save_leave_entry_impl(uuid,uuid,uuid,date,date,text,text,text,uuid,timestamptz,text) from public,anon,authenticated;
revoke all on function hr_private.cancel_leave_entry_impl(uuid,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function hr_private.leave_entry_preview_impl(uuid,uuid,date,date,text,uuid) to authenticated;
grant execute on function hr_private.save_leave_entry_impl(uuid,uuid,uuid,date,date,text,text,text,uuid,timestamptz,text) to authenticated;
grant execute on function hr_private.cancel_leave_entry_impl(uuid,timestamptz,text,uuid) to authenticated;
revoke all on function public.preview_leave_entry(uuid,uuid,date,date,text,uuid) from public,anon;
revoke all on function public.save_leave_entry(uuid,uuid,uuid,date,date,text,text,text,uuid,timestamptz,text) from public,anon;
revoke all on function public.cancel_leave_entry(uuid,timestamptz,text,uuid) from public,anon;
grant execute on function public.preview_leave_entry(uuid,uuid,date,date,text,uuid) to authenticated;
grant execute on function public.save_leave_entry(uuid,uuid,uuid,date,date,text,text,text,uuid,timestamptz,text) to authenticated;
grant execute on function public.cancel_leave_entry(uuid,timestamptz,text,uuid) to authenticated;
revoke insert,update,delete on public.leave_entries,public.leave_entry_days,public.audit_events from authenticated;
notify pgrst,'reload schema';
