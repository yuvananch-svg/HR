begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d4000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('hr.p4_generated',public.generate_leave_entitlements(2098)::text,true);
select current_setting('hr.p4_generated')::integer as generated_by_session_b;
commit;
