-- Remove only the reserved P7 synthetic graph; fail closed on unexpected rows.
begin;
do $$ begin
  if exists(select 1 from public.employees where id='a7000000-0000-4000-8000-000000000001' and employee_code<>'P7-RESTORE-EMPLOYEE')
     or exists(select 1 from public.leave_types where id='a7000000-0000-4000-8000-000000000002' and name<>'P7 Restore Rehearsal')
     or exists(select 1 from public.holidays where id='a7000000-0000-4000-8000-000000000003'
       and not (holiday_date=date '2096-01-03' and name='Synthetic restore holiday'))
     or exists(select 1 from public.leave_entries where employee_id='a7000000-0000-4000-8000-000000000001'
       and not (leave_type_id='a7000000-0000-4000-8000-000000000002'
         and (start_date,end_date) in ((date '2096-01-02',date '2096-01-04'),(date '2096-01-05',date '2096-01-05'))))
     or exists(select 1 from public.identity_documents where employee_id='a7000000-0000-4000-8000-000000000001'
       and not (document_type='Synthetic test ID' and document_number='RESTORE-ONLY-001'))
     or exists(select 1 from public.bank_accounts where employee_id='a7000000-0000-4000-8000-000000000001'
       and not (bank_name='Synthetic Test Bank' and account_name='Restore Fixture' and account_number='0000000001'))
     or exists(select 1 from public.emergency_contacts where employee_id='a7000000-0000-4000-8000-000000000001'
       and not (name='Synthetic Restore Contact' and phone='000000001' and priority=1)) then
    raise exception 'restore fixture identity mismatch; refusing cleanup';
  end if;
  if exists(select 1 from public.leave_entry_requests where actor_id='76000000-0000-4000-8000-000000000001'
      and request_key in ('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000013')
      and not (operation in ('save','cancel') and entry_id in
        (select id from public.leave_entries where employee_id='a7000000-0000-4000-8000-000000000001'))) then
    raise exception 'restore request ledger identity mismatch; refusing cleanup';
  end if;
end $$;

delete from public.audit_events where record_id in
  (select id from public.leave_entries where employee_id='a7000000-0000-4000-8000-000000000001');
delete from public.leave_entry_requests where actor_id='76000000-0000-4000-8000-000000000001'
  and request_key in ('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000013');
delete from public.leave_entry_days where leave_entry_id in
  (select id from public.leave_entries where employee_id='a7000000-0000-4000-8000-000000000001');
delete from public.leave_entries where employee_id='a7000000-0000-4000-8000-000000000001';
delete from public.leave_entitlements where employee_id='a7000000-0000-4000-8000-000000000001'
  and leave_type_id='a7000000-0000-4000-8000-000000000002' and year=2096;
delete from public.leave_policy_defaults where leave_type_id='a7000000-0000-4000-8000-000000000002' and year=2096;
delete from public.holidays where id='a7000000-0000-4000-8000-000000000003' and name='Synthetic restore holiday';
delete from public.identity_documents where employee_id='a7000000-0000-4000-8000-000000000001';
delete from public.bank_accounts where employee_id='a7000000-0000-4000-8000-000000000001';
delete from public.emergency_contacts where employee_id='a7000000-0000-4000-8000-000000000001';
delete from public.employees where id='a7000000-0000-4000-8000-000000000001' and employee_code='P7-RESTORE-EMPLOYEE';
delete from public.leave_types where id='a7000000-0000-4000-8000-000000000002' and name='P7 Restore Rehearsal';

do $$ begin
  if exists(select 1 from public.employees where id='a7000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.leave_types where id='a7000000-0000-4000-8000-000000000002')
     or exists(select 1 from public.leave_entries where employee_id='a7000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.leave_entry_requests where actor_id='76000000-0000-4000-8000-000000000001'
       and request_key in ('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000013')) then
    raise exception 'restore fixture cleanup incomplete';
  end if;
end $$;
commit;
