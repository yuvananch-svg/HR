-- Phase 3 employee registry. Apply after hr_foundation.sql and hr_accounts.sql.
-- Create migration with `supabase migration new phase3_employees` when CLI is available.

create or replace function hr_private.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end $$;

alter table public.employees
  add constraint employees_status_termination_check
  check ((status = 'active' and termination_date is null)
      or (status = 'terminated' and termination_date is not null and termination_date >= start_date));

create or replace function public.employee_search(
  p_query text default '', p_status text default 'all', p_sort text default 'employee_code',
  p_direction text default 'asc', p_offset integer default 0, p_limit integer default 25
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with filtered as (
    select e.* from public.employees e
    where (p_status = 'all' or e.status = p_status)
      and (coalesce(btrim(p_query), '') = '' or
        strpos(lower(e.employee_code), lower(btrim(p_query))) > 0 or
        strpos(lower(e.first_name), lower(btrim(p_query))) > 0 or
        strpos(lower(e.last_name), lower(btrim(p_query))) > 0 or
        strpos(lower(concat_ws(' ', e.first_name, e.last_name)), lower(btrim(p_query))) > 0 or
        strpos(lower(coalesce(e.department, '')), lower(btrim(p_query))) > 0)
  ), counted as (select count(*)::integer as total from filtered),
  paged as (
    select f.* from filtered f
    order by
      case when p_sort = 'employee_code' and p_direction <> 'desc' then lower(f.employee_code) end asc,
      case when p_sort = 'employee_code' and p_direction = 'desc' then lower(f.employee_code) end desc,
      case when p_sort = 'first_name' and p_direction <> 'desc' then lower(f.first_name) end asc,
      case when p_sort = 'first_name' and p_direction = 'desc' then lower(f.first_name) end desc,
      case when p_sort = 'last_name' and p_direction <> 'desc' then lower(f.last_name) end asc,
      case when p_sort = 'last_name' and p_direction = 'desc' then lower(f.last_name) end desc,
      case when p_sort = 'department' and p_direction <> 'desc' then lower(coalesce(f.department,'')) end asc,
      case when p_sort = 'department' and p_direction = 'desc' then lower(coalesce(f.department,'')) end desc,
      case when p_sort = 'start_date' and p_direction <> 'desc' then f.start_date end asc,
      case when p_sort = 'start_date' and p_direction = 'desc' then f.start_date end desc,
      case when p_sort = 'status' and p_direction <> 'desc' then f.status end asc,
      case when p_sort = 'status' and p_direction = 'desc' then f.status end desc,
      lower(f.employee_code) asc
    offset greatest(0, least(coalesce(p_offset, 0), 100000000))
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  select jsonb_build_object('total', counted.total, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'employee_code', employee_code,
      'first_name', first_name, 'last_name', last_name, 'department', department,
      'position', position, 'start_date', start_date, 'status', status, 'updated_at', updated_at)
      order by
        case when p_sort = 'employee_code' and p_direction <> 'desc' then lower(employee_code) end asc,
        case when p_sort = 'employee_code' and p_direction = 'desc' then lower(employee_code) end desc,
        case when p_sort = 'first_name' and p_direction <> 'desc' then lower(first_name) end asc,
        case when p_sort = 'first_name' and p_direction = 'desc' then lower(first_name) end desc,
        case when p_sort = 'last_name' and p_direction <> 'desc' then lower(last_name) end asc,
        case when p_sort = 'last_name' and p_direction = 'desc' then lower(last_name) end desc,
        case when p_sort = 'department' and p_direction <> 'desc' then lower(coalesce(department,'')) end asc,
        case when p_sort = 'department' and p_direction = 'desc' then lower(coalesce(department,'')) end desc,
        case when p_sort = 'start_date' and p_direction <> 'desc' then start_date end asc,
        case when p_sort = 'start_date' and p_direction = 'desc' then start_date end desc,
        case when p_sort = 'status' and p_direction <> 'desc' then status end asc,
        case when p_sort = 'status' and p_direction = 'desc' then status end desc,
        lower(employee_code)) from paged
  ), '[]'::jsonb)) from counted;
$$;

create or replace function public.save_employee_bank_account(
  p_employee_id uuid, p_account_id uuid, p_expected_updated_at timestamptz,
  p_expected_employee_updated_at timestamptz, p_bank_name text, p_account_name text,
  p_account_number text, p_is_primary boolean
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare current_revision timestamptz; saved_id uuid;
begin
  if nullif(btrim(p_bank_name), '') is null or nullif(btrim(p_account_name), '') is null
     or nullif(btrim(p_account_number), '') is null then
    raise exception using errcode = '22023', message = 'required_fields';
  end if;
  if p_expected_employee_updated_at is null then
    raise exception using errcode = 'P0001', message = 'revision_conflict';
  end if;
  if p_account_id is not null and p_expected_updated_at is null then
    raise exception using errcode = 'P0001', message = 'revision_conflict';
  end if;
  select e.updated_at into current_revision from public.employees e
    where e.id = p_employee_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'employee_not_found'; end if;
  if current_revision is distinct from p_expected_employee_updated_at then
    raise exception using errcode = 'P0001', message = 'revision_conflict';
  end if;
  if p_account_id is not null then
    perform 1 from public.bank_accounts b where b.id = p_account_id and b.employee_id = p_employee_id
      and b.updated_at is not distinct from p_expected_updated_at for update;
    if not found then raise exception using errcode = 'P0001', message = 'revision_conflict'; end if;
  end if;
  if p_is_primary then
    update public.bank_accounts set is_primary = false
      where employee_id = p_employee_id and is_primary and id is distinct from p_account_id;
  end if;
  if p_account_id is null then
    insert into public.bank_accounts(employee_id, bank_name, account_name, account_number, is_primary)
      values(p_employee_id, btrim(p_bank_name), btrim(p_account_name), btrim(p_account_number), coalesce(p_is_primary,false))
      returning id into saved_id;
  else
    update public.bank_accounts set bank_name = btrim(p_bank_name), account_name = btrim(p_account_name),
      account_number = btrim(p_account_number), is_primary = coalesce(p_is_primary,false)
      where id = p_account_id and employee_id = p_employee_id returning id into saved_id;
  end if;
  -- The employee timestamp is the revision for the whole bank-account collection.
  update public.employees set updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
    where id = p_employee_id;
  return saved_id;
end $$;

revoke all on function public.employee_search(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.employee_search(text,text,text,text,integer,integer) to authenticated;
revoke all on function public.save_employee_bank_account(uuid,uuid,timestamptz,timestamptz,text,text,text,boolean) from public, anon;
grant execute on function public.save_employee_bank_account(uuid,uuid,timestamptz,timestamptz,text,text,text,boolean) to authenticated;
notify pgrst, 'reload schema';
