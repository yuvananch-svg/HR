-- Run as a database administrator after foundation, accounts, and phase3 migrations.
-- Uses only disposable synthetic records and rolls the entire test back.
begin;
do $$ declare actor uuid := gen_random_uuid(); disabled_actor uuid := gen_random_uuid(); hr_actor uuid := gen_random_uuid(); uninvited_actor uuid := gen_random_uuid(); begin
  insert into hr_private.account_invites(email, role) values(actor::text || '@example.invalid','owner');
  insert into hr_private.account_invites(email, role) values(disabled_actor::text || '@example.invalid','hr');
  insert into hr_private.account_invites(email, role) values(hr_actor::text || '@example.invalid','hr');
  insert into hr_private.account_invites(email, role) values(uninvited_actor::text || '@example.invalid','hr');
  insert into auth.users(id,email) values(actor,actor::text || '@example.invalid'),(disabled_actor,disabled_actor::text || '@example.invalid'),(hr_actor,hr_actor::text || '@example.invalid'),(uninvited_actor,uninvited_actor::text || '@example.invalid');
  delete from hr_private.account_invites where email=uninvited_actor::text || '@example.invalid';
  insert into public.app_users(id,role,is_active) values(actor,'owner',true),(disabled_actor,'hr',false),(hr_actor,'hr',true);
  perform set_config('hr.phase3_actor', actor::text, true);
  perform set_config('hr.phase3_disabled_actor', disabled_actor::text, true);
  perform set_config('hr.phase3_hr_actor', hr_actor::text, true);
  perform set_config('hr.phase3_uninvited_actor', uninvited_actor::text, true);
end $$;
-- Add a transaction-local failure point to prove a failed insert rolls back the RPC's primary switch.
alter table public.bank_accounts add constraint hr_phase3_test_bank_failure check (bank_name <> 'TEST_FORCE_FAILURE') not valid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('hr.phase3_actor'),'role','authenticated')::text, true);
do $$ declare eid uuid; rev timestamptz; acct uuid; second_acct uuid; doc uuid; token text := left(current_setting('hr.phase3_actor'),8); found_row jsonb; page_one jsonb; page_two jsonb;
begin
  insert into public.employees(employee_code,first_name,last_name,start_date) values('P3-'||token||'-test','A'||token,'L'||token,'2020-01-01') returning id,updated_at into eid,rev;
  insert into public.employees(employee_code,first_name,last_name,start_date) values ('P3-'||token||'-other','G'||token,'H'||token,'2021-01-01');
  insert into public.employees(employee_code,first_name,last_name,start_date,status,termination_date)
    values ('P3-'||token||'-former','K'||token,'J'||token,'2019-01-01','terminated','2024-01-01');
  found_row := public.employee_search('A'||token||' L'||token,'all','employee_code','asc',0,25);
  if (found_row->>'total')::integer <> 1 or jsonb_array_length(found_row->'rows') <> 1 then raise exception 'search failed'; end if;
  found_row := public.employee_search(token||'-missing','all','employee_code','asc',0,25);
  if (found_row->>'total')::integer <> 0 then raise exception 'search filter leaked'; end if;
  page_one := public.employee_search(token, 'active','employee_code','asc',0,1);
  page_two := public.employee_search(token, 'active','employee_code','asc',1,1);
  if (page_one->>'total')::integer <> 2 or jsonb_array_length(page_one->'rows') <> 1
    or jsonb_array_length(page_two->'rows') <> 1
    or (page_one->'rows'->0->>'id') = (page_two->'rows'->0->>'id') then raise exception 'server pagination/status filter failed'; end if;
  begin insert into public.employees(employee_code,first_name,last_name,start_date) values(' p3-'||token||'-TEST ','Dup','Code','2020-01-01');
    raise exception using errcode='22000', message='normalized duplicate accepted'; exception when unique_violation then null; end;
  insert into public.identity_documents(employee_id,document_type,document_number) values(eid,'Foreign passport','AB-123') returning id into doc;
  if not exists(select 1 from public.identity_documents where id=doc and document_number='AB-123') then raise exception 'arbitrary document kind/number rejected'; end if;
  insert into public.emergency_contacts(employee_id,name,relationship,phone,priority) values(eid,'Contact One','friend','00001',1);
  begin insert into public.emergency_contacts(employee_id,name,relationship,phone,priority) values(eid,'Contact Two','friend','00002',1);
    raise exception using errcode='22000', message='duplicate contact priority accepted'; exception when unique_violation then null; end;
  acct := public.save_employee_bank_account(eid,null,null,rev,'Test Bank','Ada Lovelace','00001234',true);
  if not (select is_primary and account_number = '00001234' from public.bank_accounts where id=acct) then raise exception 'bank insert lost text or primary'; end if;
  select updated_at into rev from public.employees where id=eid;
  second_acct := public.save_employee_bank_account(eid,null,null,rev,'Second Bank','Ada Lovelace','00005678',false);
  select updated_at into rev from public.employees where id=eid;
  perform public.save_employee_bank_account(eid,second_acct,(select updated_at from public.bank_accounts where id=second_acct),rev,'Second Bank','Ada Lovelace','00005678',true);
  if (select is_primary from public.bank_accounts where id=acct) or not (select is_primary from public.bank_accounts where id=second_acct) then raise exception 'primary switch failed'; end if;
  select updated_at into rev from public.employees where id=eid;
  begin perform public.save_employee_bank_account(eid,null,null,rev,'TEST_FORCE_FAILURE','Ada Lovelace','00009999',true);
    raise exception using errcode='22000',message='failing insert unexpectedly succeeded'; exception when check_violation then null; end;
  if not (select is_primary from public.bank_accounts where id=second_acct) or (select count(*) from public.bank_accounts where employee_id=eid) <> 2 then raise exception 'failed bank insert left primary switch partial'; end if;
  begin perform public.save_employee_bank_account(eid,null,null,null,'Test Bank','Ada Lovelace','7777',true);
    raise exception using errcode='22000',message='NULL collection revision accepted'; exception when sqlstate 'P0001' then null; end;
  begin perform public.save_employee_bank_account(eid,second_acct,null,rev,'Second Bank','Ada Lovelace','00005678',true);
    raise exception using errcode='22000',message='NULL account revision accepted'; exception when sqlstate 'P0001' then null; end;
  begin
    perform public.save_employee_bank_account(eid,null,null,rev - interval '1 second','Second Bank','Ada Lovelace','9999',true);
    raise exception using errcode = '22000', message = 'stale collection revision accepted';
  exception when sqlstate 'P0001' then null; end;
  if (select count(*) from public.bank_accounts where employee_id=eid) <> 2 or not (select is_primary from public.bank_accounts where id=second_acct) then raise exception 'stale request partially changed banks'; end if;
  begin insert into public.employees(employee_code,first_name,last_name,start_date,status,termination_date)
    values('bad-status','No','Date','2020-01-01','terminated',null); raise exception 'invalid status/date accepted';
  exception when check_violation then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('hr.phase3_hr_actor'),'role','authenticated')::text, true);
do $$ declare token text := left(current_setting('hr.phase3_hr_actor'),8); begin
  insert into public.employees(employee_code,first_name,last_name,start_date) values('P3-'||token||'-hr','Active','HumanResources',current_date);
  update public.employees set department='HR' where employee_code='P3-'||token||'-hr';
  if not exists(select 1 from public.employees where employee_code='P3-'||token||'-hr' and department='HR') then raise exception 'active HR write failed'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('hr.phase3_uninvited_actor'),'role','authenticated')::text, true);
do $$ begin
  if (public.employee_search('', 'all','employee_code','asc',0,25)->>'total') <> '0' then raise exception 'uninvited auth user read employees'; end if;
  begin insert into public.employees(employee_code,first_name,last_name,start_date) values('uninvited-write','No','Access',current_date);
    raise exception 'uninvited write accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('hr.phase3_disabled_actor'),'role','authenticated')::text, true);
do $$ begin
  if (public.employee_search('', 'all','employee_code','asc',0,25)->>'total') <> '0' then raise exception 'disabled member read employees'; end if;
  begin insert into public.employees(employee_code,first_name,last_name,start_date) values('disabled-write','No','Access',current_date);
    raise exception 'disabled write accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform public.employee_search('', 'all','employee_code','asc',0,25); raise exception 'anon search accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: combined-name search, isolated server pagination/status, normalized duplicate code, arbitrary document, unique contact priority, HR/disabled/uninvited/anonymous access, atomic bank switch+rollback, null/stale revision rejection, status/date constraint' as result;
rollback;
