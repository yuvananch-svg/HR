-- Run with an administrator in a clean development database. Entire test rolls back.

begin;
do $$
declare o uuid:=gen_random_uuid(); h uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); u uuid:=gen_random_uuid();
begin
 insert into auth.users(id) values(o),(h),(d),(u);
 insert into public.app_users(id,role,is_active) values(o,'owner',true),(h,'hr',true),(d,'hr',false);
 perform set_config('hr.test_owner',o::text,true); perform set_config('hr.test_hr',h::text,true);
 perform set_config('hr.test_disabled',d::text,true); perform set_config('hr.test_unknown',u::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.test_owner'),'role','authenticated')::text,true);
do $$ begin
 insert into public.employees(employee_code,first_name,last_name,start_date) values('TEST-001','ทดสอบ','ระบบ','2026-01-01');
 if (select count(*) from public.employees)<>1 then raise exception 'owner read failed'; end if;
 begin insert into public.employees(employee_code,first_name,last_name,start_date) values(' test-001 ','ซ้ำ','ระบบ','2026-01-01'); raise exception 'duplicate accepted'; exception when unique_violation then null; end;
 begin insert into public.app_users(id,role) values(current_setting('hr.test_unknown')::uuid,'owner'); raise exception 'escalation accepted'; exception when insufficient_privilege then null; end;
 begin insert into public.leave_entries(employee_id,leave_type_id,start_date,end_date,day_unit,recorded_by) values(gen_random_uuid(),gen_random_uuid(),current_date,current_date,'full',current_setting('hr.test_owner')::uuid); raise exception 'direct leave write accepted'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.test_hr'),'role','authenticated')::text,true);
do $$ begin
 if (select count(*) from public.employees)<>1 then raise exception 'hr shared read failed'; end if;
 update public.employees set department='HR';
 if (select count(*) from public.employees where department='HR')<>1 then raise exception 'hr update failed'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.test_disabled'),'role','authenticated')::text,true);
do $$ begin
 if (select count(*) from public.employees)<>0 then raise exception 'disabled user read data'; end if;
 begin insert into public.employees(employee_code,first_name,last_name,start_date) values('DENIED','ทดสอบ','ระบบ',current_date); raise exception 'disabled write accepted'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('hr.test_unknown'),'role','authenticated','user_metadata',json_build_object('role','owner'))::text,true);
do $$ begin
 if (select count(*) from public.employees)<>0 then raise exception 'non-member read data'; end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin perform 1 from public.employees; raise exception 'anon read accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare t text; lt uuid; e uuid; begin
 select id into e from public.employees limit 1;
 insert into public.leave_types(name) values('TEST') returning id into lt;
 begin insert into public.leave_policy_defaults(leave_type_id,year,quota_days) values(lt,2026,0.3); raise exception 'bad increment accepted'; exception when check_violation then null; end;
 begin insert into public.leave_entitlements(employee_id,leave_type_id,year,quota_days,source) values(e,lt,2026,1,'override'); raise exception 'override without reason accepted'; exception when check_violation then null; end;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) then raise exception 'missing RLS'; end if;
end $$;
select 'PASS: owner/HR shared access; disabled/non-member/anon denied; privilege escalation and direct leave writes denied; unique code, half-day quota and override constraints; all tables RLS' as result;
rollback;