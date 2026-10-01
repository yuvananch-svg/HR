-- Synthetic, fixed-identity graph used only by the ephemeral PostgreSQL CI drill.
-- Requires the two local .invalid owner/HR actors installed by local-regression.
begin;
do $$ begin
  if exists(select 1 from public.employees where id='a7000000-0000-4000-8000-000000000001' or employee_code='P7-RESTORE-EMPLOYEE')
     or exists(select 1 from public.leave_types where id='a7000000-0000-4000-8000-000000000002' or lower(btrim(name))='p7 restore rehearsal')
     or exists(select 1 from public.holidays where id='a7000000-0000-4000-8000-000000000003' or holiday_date=date '2096-01-03')
     or exists(select 1 from public.leave_entry_requests where actor_id='76000000-0000-4000-8000-000000000001'
       and request_key in ('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000013')) then
    raise exception 'restore rehearsal fixture collision; refusing to overwrite existing rows';
  end if;
  if not exists(select 1 from public.app_users where id='76000000-0000-4000-8000-000000000001' and role='owner' and is_active)
     or not exists(select 1 from public.app_users where id='76000000-0000-4000-8000-000000000002' and role='hr' and is_active) then
    raise exception 'restore rehearsal requires the local synthetic owner and HR actors';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"76000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare
  employee constant uuid := 'a7000000-0000-4000-8000-000000000001';
  leave_type constant uuid := 'a7000000-0000-4000-8000-000000000002';
  leave_holiday constant uuid := 'a7000000-0000-4000-8000-000000000003';
  owner_id constant uuid := '76000000-0000-4000-8000-000000000001';
  monday constant date := date '2096-01-02';
  emp_revision timestamptz;
  saved_holiday public.holidays;
  preview jsonb;
  recorded_entry uuid;
  cancelled_entry uuid;
  entry_revision timestamptz;
  bank_id uuid;
begin
  if extract(isodow from monday)<>1 then raise exception 'fixture workday assumption changed'; end if;
  insert into public.employees(id,employee_code,first_name,last_name,start_date,department,position)
  values(employee,'P7-RESTORE-EMPLOYEE','Synthetic','Restore Drill',date '1990-01-01','Test Unit','Restore Fixture');
  insert into public.identity_documents(employee_id,document_type,document_number,issuing_country)
  values(employee,'Synthetic test ID','RESTORE-ONLY-001','XX');
  insert into public.emergency_contacts(employee_id,name,relationship,phone,priority)
  values(employee,'Synthetic Restore Contact','test fixture','000000001',1);
  select updated_at into emp_revision from public.employees where id=employee;
  bank_id:=public.save_employee_bank_account(employee,null,null,emp_revision,
    'Synthetic Test Bank','Restore Fixture','0000000001',true);
  if not exists(select 1 from public.bank_accounts where id=bank_id and employee_id=employee and is_primary) then
    raise exception 'synthetic bank account RPC did not persist';
  end if;

  perform public.save_leave_type(leave_type,'P7 Restore Rehearsal',true,900001,null);
  perform public.save_leave_policy_default(null,leave_type,2096,12.0,null);
  if public.generate_leave_entitlements(2096)<>1 then raise exception 'expected one synthetic entitlement'; end if;
  saved_holiday:=public.save_holiday(leave_holiday,monday+1,'Synthetic restore holiday',null);

  preview:=public.preview_leave_entry(employee,leave_type,monday,monday+2,'full',null);
  if (select count(*) from jsonb_array_elements(preview->'days') d where (d->>'days')::numeric=1)<>2 then
    raise exception 'synthetic recorded entry should charge two days around its holiday';
  end if;
  recorded_entry:=public.save_leave_entry('a7000000-0000-4000-8000-000000000011',employee,leave_type,
    monday,monday+2,'full','Synthetic restore rehearsal',preview->>'fingerprint',null,null,null);

  preview:=public.preview_leave_entry(employee,leave_type,monday+3,monday+3,'full',null);
  cancelled_entry:=public.save_leave_entry('a7000000-0000-4000-8000-000000000012',employee,leave_type,
    monday+3,monday+3,'full','Synthetic entry to cancel',preview->>'fingerprint',null,null,null);
  select updated_at into entry_revision from public.leave_entries where id=cancelled_entry;
  perform public.cancel_leave_entry(cancelled_entry,entry_revision,'Synthetic restore cancellation',
    'a7000000-0000-4000-8000-000000000013');

  if (select count(*) from public.leave_entries where id in(recorded_entry,cancelled_entry))<>2
     or (select count(*) from public.leave_entry_days where leave_entry_id in(recorded_entry,cancelled_entry))<>3
     or (select count(*) from public.leave_entry_requests where actor_id=owner_id
        and request_key in ('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000013'))<>3 then
    raise exception 'synthetic save/cancel RPC graph is incomplete';
  end if;
end $$;
reset role;
commit;
