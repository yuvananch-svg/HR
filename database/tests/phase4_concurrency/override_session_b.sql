begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d4000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('hr.p4_saved_revision',(public.save_leave_entitlement(
  'd4000000-0000-4000-8000-000000000002',
  'd4000000-0000-4000-8000-000000000003',
  2098, 3.0, 'P4 concurrency session B',
  'REPLACE_WITH_REVISION'::timestamptz
)).updated_at::text,true);
select current_setting('hr.p4_saved_revision')::timestamptz as saved_revision;
commit;
