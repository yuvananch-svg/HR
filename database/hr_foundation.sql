-- Applied to HRM project kedohmbtpegupndldkex on 2026-09-30.
-- Migration names: hr_foundation_tables_and_rls, restrict_internal_rls_event_trigger_execution.
-- Fresh database only; do not rerun on an already initialized database.

create schema hr_private;
revoke all on schema hr_private from public, anon, authenticated;
create table public.app_users (
 id uuid primary key references auth.users(id) on delete restrict,
 role text not null check(role in ('owner','hr')),
 is_active boolean not null default true,
 display_name text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.employees (
 id uuid primary key default gen_random_uuid(),
 employee_code text not null check(btrim(employee_code)<>''),
 first_name text not null check(btrim(first_name)<>''),
 last_name text not null check(btrim(last_name)<>''),
 address text, position text, department text,
 start_date date not null, phone text,
 status text not null default 'active' check(status in ('active','terminated')),
 termination_date date check(termination_date is null or termination_date >= start_date),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index employees_code_unique on public.employees(lower(btrim(employee_code)));
create index employees_department_idx on public.employees(department);
create index employees_name_idx on public.employees(last_name,first_name);
create table public.identity_documents (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete restrict,
 document_type text not null check(btrim(document_type)<>''), document_number text not null check(btrim(document_number)<>''),
 issuing_country text, expires_on date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(employee_id,document_type,document_number)
);
create table public.bank_accounts (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete restrict,
 bank_name text not null check(btrim(bank_name)<>''), account_name text not null check(btrim(account_name)<>''),
 account_number text not null check(btrim(account_number)<>''), is_primary boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index bank_accounts_employee_idx on public.bank_accounts(employee_id);
create unique index bank_accounts_primary_unique on public.bank_accounts(employee_id) where is_primary;
create table public.emergency_contacts (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete restrict,
 name text not null check(btrim(name)<>''), relationship text not null, phone text not null check(btrim(phone)<>''),
 priority integer not null default 1 check(priority>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(employee_id,priority)
);
create table public.leave_types (
 id uuid primary key default gen_random_uuid(), name text not null check(btrim(name)<>''),
 is_active boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index leave_types_name_unique on public.leave_types(lower(btrim(name)));
create table public.leave_policy_defaults (
 id uuid primary key default gen_random_uuid(), leave_type_id uuid not null references public.leave_types(id) on delete restrict,
 year integer not null check(year between 1900 and 9999),
 quota_days numeric(6,1) not null check(quota_days>=0 and mod(quota_days,0.5)=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(leave_type_id,year)
);
create table public.leave_entitlements (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete restrict,
 leave_type_id uuid not null references public.leave_types(id) on delete restrict,
 year integer not null check(year between 1900 and 9999),
 quota_days numeric(6,1) not null check(quota_days>=0 and mod(quota_days,0.5)=0),
 source text not null check(source in ('policy','override')), override_reason text,
 check(source<>'override' or nullif(btrim(override_reason),'') is not null),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(employee_id,leave_type_id,year)
);
create index leave_entitlements_type_idx on public.leave_entitlements(leave_type_id,year);
create table public.holidays (
 id uuid primary key default gen_random_uuid(), holiday_date date not null unique,
 name text not null check(btrim(name)<>''), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.leave_entries (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete restrict,
 leave_type_id uuid not null references public.leave_types(id) on delete restrict,
 start_date date not null, end_date date not null check(end_date>=start_date),
 day_unit text not null check(day_unit in ('full','half')), half_period text check(half_period in ('morning','afternoon')),
 check((day_unit='full' and half_period is null) or (day_unit='half' and start_date=end_date and half_period is not null)),
 reason text, status text not null default 'recorded' check(status in ('recorded','cancelled')),
 recorded_by uuid not null references public.app_users(id) on delete restrict,
 updated_by uuid references public.app_users(id) on delete restrict, change_reason text,
 cancelled_at timestamptz, cancelled_by uuid references public.app_users(id) on delete restrict,
 check((status='recorded' and cancelled_at is null and cancelled_by is null) or
 (status='cancelled' and cancelled_at is not null and cancelled_by is not null and nullif(btrim(change_reason),'') is not null)),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index leave_entries_employee_dates_idx on public.leave_entries(employee_id,start_date,end_date);
create index leave_entries_type_idx on public.leave_entries(leave_type_id);
create index leave_entries_recorded_by_idx on public.leave_entries(recorded_by);
create index leave_entries_updated_by_idx on public.leave_entries(updated_by);
create index leave_entries_cancelled_by_idx on public.leave_entries(cancelled_by);
create table public.leave_entry_days (
 id uuid primary key default gen_random_uuid(), leave_entry_id uuid not null references public.leave_entries(id) on delete restrict,
 leave_date date not null, days numeric(2,1) not null check(days in (0.5,1.0)),
 half_period text check(half_period in ('morning','afternoon')),
 check((days=1 and half_period is null) or (days=0.5 and half_period is not null)),
 unique(leave_entry_id,leave_date)
);
create index leave_entry_days_date_idx on public.leave_entry_days(leave_date);
create table public.audit_events (
 id uuid primary key default gen_random_uuid(), actor_id uuid references public.app_users(id) on delete restrict,
 occurred_at timestamptz not null default now(), table_name text not null,
 record_id uuid not null, action text not null check(action in ('INSERT','UPDATE','DELETE')),
 changed_fields text[] not null default '{}', reason text,
 before_values jsonb, after_values jsonb
);
create index audit_events_actor_idx on public.audit_events(actor_id);
create index audit_events_record_idx on public.audit_events(table_name,record_id,occurred_at desc);
create index audit_events_time_idx on public.audit_events(occurred_at desc);

create function hr_private.touch_updated_at() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.updated_at=now(); return new; end $$;
revoke all on function hr_private.touch_updated_at() from public,anon,authenticated;

alter table public.app_users enable row level security;
revoke all on public.app_users from public,anon,authenticated;
grant select on public.app_users to authenticated;
create policy own_active_membership on public.app_users for select to authenticated
using(id=(select auth.uid()) and is_active and role in ('owner','hr'));

do $$
declare t text; allowed text := 'exists (select 1 from public.app_users where id=(select auth.uid()) and is_active and role in (''owner'',''hr''))';
begin
 foreach t in array array['employees','identity_documents','bank_accounts','emergency_contacts','leave_types','leave_policy_defaults','leave_entitlements','holidays','leave_entries','leave_entry_days','audit_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy staff_read on public.%I for select to authenticated using (%s)',t,allowed);
  if t not in ('leave_entries','leave_entry_days','audit_events') then
   execute format('grant insert,update on public.%I to authenticated',t);
   execute format('create policy staff_insert on public.%I for insert to authenticated with check (%s)',t,allowed);
   execute format('create policy staff_update on public.%I for update to authenticated using (%s) with check (%s)',t,allowed,allowed);
  end if;
 end loop;
 foreach t in array array['app_users','employees','identity_documents','bank_accounts','emergency_contacts','leave_types','leave_policy_defaults','leave_entitlements','holidays','leave_entries'] loop
  execute format('create trigger touch_updated_at before update on public.%I for each row execute function hr_private.touch_updated_at()',t);
 end loop;
end $$;
comment on table public.leave_entries is 'Foundation only: client writes disabled until transactional leave RPC validates balance, overlaps, working days and audit in phase 5.';
comment on table public.app_users is 'Allowlist managed only by trusted administrator; owner and hr share organization records. No automatic signup authorization.';
comment on table public.audit_events is 'Append-only for clients. Sensitive values must be redacted by future audit writer.';
notify pgrst,'reload schema';

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;