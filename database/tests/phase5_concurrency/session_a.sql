-- Run session A, then start session_b.sql while this script is sleeping.
begin;
set local application_name='hr_phase5_race_a';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d5000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare p jsonb; saved uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-types-config',0));
  p:=public.preview_leave_entry('d5000000-0000-4000-8000-000000000002','d5000000-0000-4000-8000-000000000003','2097-01-07','2097-01-07','full',null);
  -- Take locks in the exact RPC order so B waits before holding overlap/quota locks.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('leave-policy-year:2097',0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('d5000000-0000-4000-8000-000000000002:d5000000-0000-4000-8000-000000000003:2097',0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leave-overlap:d5000000-0000-4000-8000-000000000002',0));
  raise notice 'Session A holds Phase 5 locks; start session B now.';
  perform pg_sleep(5);
  saved:=public.save_leave_entry('d5000000-0000-4000-8000-00000000000a','d5000000-0000-4000-8000-000000000002','d5000000-0000-4000-8000-000000000003','2097-01-07','2097-01-07','full','session A',p->>'fingerprint',null,null,null);
  raise notice 'PASS: session A saved entry %',saved;
end $$;
commit;
