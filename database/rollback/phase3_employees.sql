-- Roll back phase 3 only when no phase 3 data must be preserved.
drop function if exists public.save_employee_bank_account(uuid,uuid,timestamptz,timestamptz,text,text,text,boolean);
drop function if exists public.employee_search(text,text,text,text,integer,integer);
alter table public.employees drop constraint if exists employees_status_termination_check;
-- Restore foundation's original trigger behavior.
create or replace function hr_private.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
notify pgrst, 'reload schema';
