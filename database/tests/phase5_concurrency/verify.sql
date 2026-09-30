-- Administrator verification after both sessions have committed.
do $$ begin
  if (select count(*) from public.leave_entries where employee_id='d5000000-0000-4000-8000-000000000002' and start_date='2097-01-07' and status='recorded')<>1 then
    raise exception 'expected exactly one recorded fixture leave entry';
  end if;
  if (select count(*) from public.leave_entry_days d join public.leave_entries e on e.id=d.leave_entry_id
      where e.employee_id='d5000000-0000-4000-8000-000000000002' and d.leave_date='2097-01-07' and d.days=1)<>1 then
    raise exception 'expected exactly one charged leave day';
  end if;
  if (select count(*) from public.audit_events where table_name='leave_entries' and record_id in
      (select id from public.leave_entries where employee_id='d5000000-0000-4000-8000-000000000002'))<>1 then
    raise exception 'expected exactly one leave audit event';
  end if;
end $$;
select 'Fixture state: one recorded entry, one charged date, and one audit event' as result;
