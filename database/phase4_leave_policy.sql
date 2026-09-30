-- Phase 4 leave policy writes. Apply after hr_foundation.sql and phase3_employees.sql.
-- Tables remain readable through RLS, but all policy writes are RPC-only. Definer
-- routines explicitly require active owner/HR, use an empty search_path and are
-- executable only by authenticated callers; clients cannot perform table DML.

create or replace function hr_private.assert_active_staff()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.app_users u where u.id=(select auth.uid())
      and u.is_active and u.role in ('owner','hr')
  ) then raise exception using errcode='42501', message='active_staff_required'; end if;
end $$;
revoke all on function hr_private.assert_active_staff() from public,anon,authenticated;

-- Ensure every revision-bearing policy table gets a distinct updated_at even
-- for repeated updates in one transaction; callers use it for optimistic locking.
create or replace function hr_private.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end $$;
revoke all on function hr_private.touch_updated_at() from public,anon,authenticated;

-- The foundation index only trims U+0020. Replace it with whitespace trimming
-- so the database matches the name normalization used by the application.
do $$ begin
  if exists (
    select 1 from public.leave_types
    group by lower(btrim(name,E' \t\n\r\f'))
    having count(*)>1
  ) then raise exception 'leave type names collide after normalized trimming'; end if;
end $$;
drop index public.leave_types_name_unique;
create unique index leave_types_name_unique
  on public.leave_types(lower(btrim(name,E' \t\n\r\f')));

create or replace function hr_private.save_leave_entitlement_impl(
  p_employee_id uuid, p_leave_type_id uuid, p_year integer, p_quota_days numeric,
  p_reason text, p_expected_updated_at timestamptz
) returns public.leave_entitlements
language plpgsql security definer set search_path = '' as $$
declare current_row public.leave_entitlements; used_days numeric;
begin
  perform hr_private.assert_active_staff();
  if p_employee_id is null or p_leave_type_id is null or p_year is null or p_year not between 1900 and 9999 or p_quota_days is null or p_quota_days < 0
     or mod(p_quota_days, 0.5) <> 0 or p_quota_days > 99999.9
     or nullif(btrim(p_reason,E' \t\n\r\f'), '') is null or length(btrim(p_reason,E' \t\n\r\f'))>500 then
    raise exception using errcode='22023', message='invalid_entitlement';
  end if;
  -- Shared lock key for every entitlement change and the future leave-entry RPC.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-policy-year:'||p_year::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_employee_id::text || ':' || p_leave_type_id::text || ':' || p_year::text, 0));
  select le.* into current_row from public.leave_entitlements le
    where le.employee_id=p_employee_id and le.leave_type_id=p_leave_type_id and le.year=p_year
    for update;
  if not found then raise exception using errcode='P0002', message='entitlement_not_found'; end if;
  if p_expected_updated_at is null or current_row.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='P0001', message='revision_conflict';
  end if;
  select coalesce(sum(d.days),0) into used_days
    from public.leave_entry_days d join public.leave_entries e on e.id=d.leave_entry_id
    where e.employee_id=p_employee_id and e.leave_type_id=p_leave_type_id
      and e.status='recorded' and d.leave_date >= make_date(p_year,1,1)
      and d.leave_date <= make_date(p_year,12,31);
  if p_quota_days < used_days then
    raise exception using errcode='P0001', message='quota_below_used';
  end if;
  update public.leave_entitlements set quota_days=p_quota_days, source='override',
    override_reason=btrim(p_reason,E' \t\n\r\f')
    where id=current_row.id returning * into current_row;
  return current_row;
end $$;

create or replace function hr_private.reset_leave_entitlement_impl(
  p_employee_id uuid, p_leave_type_id uuid, p_year integer,
  p_expected_updated_at timestamptz
) returns public.leave_entitlements
language plpgsql security definer set search_path = '' as $$
declare current_row public.leave_entitlements; policy_quota numeric; used_days numeric;
begin
  perform hr_private.assert_active_staff();
  if p_employee_id is null or p_leave_type_id is null or p_year is null or p_year not between 1900 and 9999 then raise exception using errcode='22023',message='invalid_year'; end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-policy-year:'||p_year::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_employee_id::text || ':' || p_leave_type_id::text || ':' || p_year::text, 0));
  select le.* into current_row from public.leave_entitlements le
    where le.employee_id=p_employee_id and le.leave_type_id=p_leave_type_id and le.year=p_year for update;
  if not found then raise exception using errcode='P0002', message='entitlement_not_found'; end if;
  if p_expected_updated_at is null or current_row.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='P0001', message='revision_conflict';
  end if;
  select d.quota_days into policy_quota from public.leave_policy_defaults d
    where d.leave_type_id=p_leave_type_id and d.year=p_year for share;
  if not found then raise exception using errcode='P0002', message='policy_not_found'; end if;
  select coalesce(sum(d.days),0) into used_days
    from public.leave_entry_days d join public.leave_entries e on e.id=d.leave_entry_id
    where e.employee_id=p_employee_id and e.leave_type_id=p_leave_type_id
      and e.status='recorded' and d.leave_date >= make_date(p_year,1,1)
      and d.leave_date <= make_date(p_year,12,31);
  if policy_quota < used_days then raise exception using errcode='P0001', message='quota_below_used'; end if;
  update public.leave_entitlements set quota_days=policy_quota, source='policy', override_reason=null
    where id=current_row.id returning * into current_row;
  return current_row;
end $$;

create or replace function hr_private.generate_leave_entitlements_impl(p_year integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare missing_count integer; inserted_count integer;
begin
  perform hr_private.assert_active_staff();
  if p_year is null or p_year not between 1900 and 9999 then
    raise exception using errcode='22023', message='invalid_year';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leave-types-config',0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leave-policy-year:'||p_year::text,0));
  perform 1 from public.leave_types t where t.is_active for share;
  perform 1 from public.leave_policy_defaults p where p.year=p_year for share;
  perform 1 from public.employees e where e.status='active' order by e.id for share;
  -- Acquire the same per employee/type/year lock used by quota changes and
  -- reserved for phase 5 leave mutations, in deterministic order.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    e.id::text || ':' || t.id::text || ':' || p_year::text,0))
    from public.employees e cross join public.leave_types t
    where e.status='active' and t.is_active order by e.id,t.id;
  select count(*) into missing_count from public.leave_types t
    where t.is_active and not exists (
      select 1 from public.leave_policy_defaults p where p.leave_type_id=t.id and p.year=p_year);
  if missing_count > 0 then raise exception using errcode='P0001', message='missing_policy_defaults'; end if;
  insert into public.leave_entitlements(employee_id,leave_type_id,year,quota_days,source)
    select e.id,p.leave_type_id,p.year,p.quota_days,'policy'
    from public.employees e cross join public.leave_policy_defaults p
      join public.leave_types t on t.id=p.leave_type_id and t.is_active
    where e.status='active' and p.year=p_year
    on conflict(employee_id,leave_type_id,year) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end $$;

create or replace function hr_private.save_leave_type_impl(
  p_id uuid, p_name text, p_is_active boolean, p_sort_order integer,
  p_expected_updated_at timestamptz
) returns public.leave_types
language plpgsql security definer set search_path = '' as $$
declare saved public.leave_types; normalized_name text;
begin
  perform hr_private.assert_active_staff();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leave-types-config',0));
  normalized_name:=btrim(p_name,E' \t\n\r\f');
  if normalized_name is null or normalized_name='' or length(normalized_name)>120
     or p_sort_order is null or p_is_active is null or p_sort_order < 0 or p_sort_order > 100000 then
    raise exception using errcode='22023', message='invalid_leave_type';
  end if;
  if p_id is null then
    insert into public.leave_types(name,is_active,sort_order)
      values(normalized_name,coalesce(p_is_active,true),p_sort_order) returning * into saved;
  else
    update public.leave_types set name=normalized_name,is_active=p_is_active,sort_order=p_sort_order
      where id=p_id and updated_at is not distinct from p_expected_updated_at returning * into saved;
    if not found then raise exception using errcode='P0001', message='revision_conflict'; end if;
  end if;
  return saved;
end $$;

create or replace function hr_private.save_leave_policy_default_impl(
  p_id uuid, p_leave_type_id uuid, p_year integer, p_quota_days numeric,
  p_expected_updated_at timestamptz
) returns public.leave_policy_defaults
language plpgsql security definer set search_path = '' as $$
declare saved public.leave_policy_defaults;
begin
  perform hr_private.assert_active_staff();
  if p_leave_type_id is null or p_year is null or p_year not between 1900 and 9999 or p_quota_days is null or p_quota_days < 0
     or mod(p_quota_days,0.5)<>0 or p_quota_days>99999.9 then
    raise exception using errcode='22023', message='invalid_policy';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leave-policy-year:'||p_year::text,0));
  if p_id is null then
    insert into public.leave_policy_defaults(leave_type_id,year,quota_days)
      values(p_leave_type_id,p_year,p_quota_days) returning * into saved;
  else
    update public.leave_policy_defaults set quota_days=p_quota_days
      where id=p_id and leave_type_id=p_leave_type_id and year=p_year
        and updated_at is not distinct from p_expected_updated_at returning * into saved;
    if not found then raise exception using errcode='P0001', message='revision_conflict'; end if;
  end if;
  return saved;
end $$;

create or replace function hr_private.save_holiday_impl(
  p_id uuid, p_holiday_date date, p_name text, p_expected_updated_at timestamptz
) returns public.holidays
language plpgsql security definer set search_path = '' as $$
declare saved public.holidays;
begin
  perform hr_private.assert_active_staff();
  if p_holiday_date is null or nullif(btrim(p_name,E' \t\n\r\f'),'') is null or length(btrim(p_name,E' \t\n\r\f'))>160 then
    raise exception using errcode='22023', message='invalid_holiday';
  end if;
  if p_id is null then
    insert into public.holidays(holiday_date,name) values(p_holiday_date,btrim(p_name,E' \t\n\r\f')) returning * into saved;
  else
    update public.holidays set holiday_date=p_holiday_date,name=btrim(p_name,E' \t\n\r\f')
      where id=p_id and updated_at is not distinct from p_expected_updated_at returning * into saved;
    if not found then raise exception using errcode='P0001', message='revision_conflict'; end if;
  end if;
  return saved;
end $$;

create or replace function hr_private.delete_holiday_impl(p_id uuid,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform hr_private.assert_active_staff();
  delete from public.holidays where id=p_id and updated_at=p_expected_updated_at;
  if not found then raise exception using errcode='P0001',message='revision_conflict'; end if;
end $$;

create or replace function hr_private.copy_leave_policy_defaults_impl(p_from_year integer,p_to_year integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare copied_count integer; first_year integer; second_year integer;
begin
  perform hr_private.assert_active_staff();
  if p_from_year is null or p_to_year is null or p_from_year not between 1900 and 9999
    or p_to_year not between 1900 and 9999 or p_from_year=p_to_year then
    raise exception using errcode='22023',message='invalid_copy_year';
  end if;
  first_year:=least(p_from_year,p_to_year); second_year:=greatest(p_from_year,p_to_year);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leave-policy-year:'||first_year::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leave-policy-year:'||second_year::text,0));
  insert into public.leave_policy_defaults(leave_type_id,year,quota_days)
    select p.leave_type_id,p_to_year,p.quota_days from public.leave_policy_defaults p
    where p.year=p_from_year
      and not exists(select 1 from public.leave_policy_defaults existing
        where existing.leave_type_id=p.leave_type_id and existing.year=p_to_year)
    on conflict(leave_type_id,year) do nothing;
  get diagnostics copied_count=row_count;
  return copied_count;
end $$;


create or replace function public.save_leave_entitlement(p_employee_id uuid,p_leave_type_id uuid,p_year integer,p_quota_days numeric,p_reason text,p_expected_updated_at timestamptz)
returns public.leave_entitlements language plpgsql security invoker set search_path = '' as $$ begin return hr_private.save_leave_entitlement_impl(p_employee_id,p_leave_type_id,p_year,p_quota_days,p_reason,p_expected_updated_at); end $$;
create or replace function public.reset_leave_entitlement(p_employee_id uuid,p_leave_type_id uuid,p_year integer,p_expected_updated_at timestamptz)
returns public.leave_entitlements language plpgsql security invoker set search_path = '' as $$ begin return hr_private.reset_leave_entitlement_impl(p_employee_id,p_leave_type_id,p_year,p_expected_updated_at); end $$;
create or replace function public.generate_leave_entitlements(p_year integer)
returns integer language sql security invoker set search_path = '' as $$ select hr_private.generate_leave_entitlements_impl(p_year) $$;
create or replace function public.save_leave_type(p_id uuid,p_name text,p_is_active boolean,p_sort_order integer,p_expected_updated_at timestamptz)
returns public.leave_types language plpgsql security invoker set search_path = '' as $$ begin return hr_private.save_leave_type_impl(p_id,p_name,p_is_active,p_sort_order,p_expected_updated_at); end $$;
create or replace function public.save_leave_policy_default(p_id uuid,p_leave_type_id uuid,p_year integer,p_quota_days numeric,p_expected_updated_at timestamptz)
returns public.leave_policy_defaults language plpgsql security invoker set search_path = '' as $$ begin return hr_private.save_leave_policy_default_impl(p_id,p_leave_type_id,p_year,p_quota_days,p_expected_updated_at); end $$;
create or replace function public.save_holiday(p_id uuid,p_holiday_date date,p_name text,p_expected_updated_at timestamptz)
returns public.holidays language plpgsql security invoker set search_path = '' as $$ begin return hr_private.save_holiday_impl(p_id,p_holiday_date,p_name,p_expected_updated_at); end $$;
create or replace function public.delete_holiday(p_id uuid,p_expected_updated_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$ begin perform hr_private.delete_holiday_impl(p_id,p_expected_updated_at); return; end $$;
create or replace function public.copy_leave_policy_defaults(p_from_year integer,p_to_year integer)
returns integer language sql security invoker set search_path = '' as $$ select hr_private.copy_leave_policy_defaults_impl(p_from_year,p_to_year) $$;

revoke all on function public.save_leave_entitlement(uuid,uuid,integer,numeric,text,timestamptz) from public,anon;
revoke all on function public.reset_leave_entitlement(uuid,uuid,integer,timestamptz) from public,anon;
revoke all on function public.generate_leave_entitlements(integer) from public,anon;
revoke all on function public.save_leave_type(uuid,text,boolean,integer,timestamptz) from public,anon;
revoke all on function public.save_leave_policy_default(uuid,uuid,integer,numeric,timestamptz) from public,anon;
revoke all on function public.save_holiday(uuid,date,text,timestamptz) from public,anon;
revoke all on function public.delete_holiday(uuid,timestamptz) from public,anon;
revoke all on function public.copy_leave_policy_defaults(integer,integer) from public,anon;
grant usage on schema hr_private to authenticated;
revoke all on function hr_private.save_leave_entitlement_impl(uuid,uuid,integer,numeric,text,timestamptz) from public,anon;
revoke all on function hr_private.reset_leave_entitlement_impl(uuid,uuid,integer,timestamptz) from public,anon;
revoke all on function hr_private.generate_leave_entitlements_impl(integer) from public,anon;
revoke all on function hr_private.save_leave_type_impl(uuid,text,boolean,integer,timestamptz) from public,anon;
revoke all on function hr_private.save_leave_policy_default_impl(uuid,uuid,integer,numeric,timestamptz) from public,anon;
revoke all on function hr_private.save_holiday_impl(uuid,date,text,timestamptz) from public,anon;
revoke all on function hr_private.delete_holiday_impl(uuid,timestamptz) from public,anon;
revoke all on function hr_private.copy_leave_policy_defaults_impl(integer,integer) from public,anon;
grant execute on function hr_private.save_leave_entitlement_impl(uuid,uuid,integer,numeric,text,timestamptz) to authenticated;
grant execute on function hr_private.reset_leave_entitlement_impl(uuid,uuid,integer,timestamptz) to authenticated;
grant execute on function hr_private.generate_leave_entitlements_impl(integer) to authenticated;
grant execute on function hr_private.save_leave_type_impl(uuid,text,boolean,integer,timestamptz) to authenticated;
grant execute on function hr_private.save_leave_policy_default_impl(uuid,uuid,integer,numeric,timestamptz) to authenticated;
grant execute on function hr_private.save_holiday_impl(uuid,date,text,timestamptz) to authenticated;
grant execute on function hr_private.delete_holiday_impl(uuid,timestamptz) to authenticated;
grant execute on function hr_private.copy_leave_policy_defaults_impl(integer,integer) to authenticated;
revoke insert,update,delete on public.leave_types,public.leave_policy_defaults,public.leave_entitlements,public.holidays from authenticated;
grant execute on function public.save_leave_entitlement(uuid,uuid,integer,numeric,text,timestamptz) to authenticated;
grant execute on function public.reset_leave_entitlement(uuid,uuid,integer,timestamptz) to authenticated;
grant execute on function public.generate_leave_entitlements(integer) to authenticated;
grant execute on function public.save_leave_type(uuid,text,boolean,integer,timestamptz) to authenticated;
grant execute on function public.save_leave_policy_default(uuid,uuid,integer,numeric,timestamptz) to authenticated;
grant execute on function public.save_holiday(uuid,date,text,timestamptz) to authenticated;
grant execute on function public.delete_holiday(uuid,timestamptz) to authenticated;
grant execute on function public.copy_leave_policy_defaults(integer,integer) to authenticated;
notify pgrst, 'reload schema';
