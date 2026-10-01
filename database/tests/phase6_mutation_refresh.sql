-- Run as database administrator after Phase 4/5 migrations.
-- Reuses an existing active owner for RPC identity checks without auth changes.
-- Administrator access is needed to assert the private request ledger.
-- All synthetic employee/type/entry/quota/holiday mutations roll back.
begin;
do $$ declare emp uuid; t1 uuid; t2 uuid; actor uuid; begin
select id into actor from app_users where role='owner' and is_active limit 1;
if actor is null then raise exception 'missing existing owner'; end if;
perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
insert into employees(employee_code,first_name,last_name,start_date) values('P6-ROLLBACK-'||gen_random_uuid(),'P6','Rollback','2020-01-01') returning id into emp;
insert into leave_types(name) values('P6 rollback A '||gen_random_uuid()) returning id into t1;
insert into leave_types(name) values('P6 rollback B '||gen_random_uuid()) returning id into t2;
insert into leave_entitlements(employee_id,leave_type_id,year,quota_days,source) values(emp,t1,2098,4,'policy'),(emp,t2,2099,4,'policy');
perform set_config('hr.p6_emp',emp::text,true); perform set_config('hr.p6_t1',t1::text,true); perform set_config('hr.p6_t2',t2::text,true);
end $$;

do $$ declare emp uuid:=current_setting('hr.p6_emp')::uuid; t1 uuid:=current_setting('hr.p6_t1')::uuid; t2 uuid:=current_setting('hr.p6_t2')::uuid; old_date date:='2098-01-06'; new_date date:='2099-01-05'; p jsonb; eid uuid; rev timestamptz; ent public.leave_entitlements; hol public.holidays; before_state jsonb; after_state jsonb; message text;
begin
while extract(isodow from old_date) in (6,7) loop old_date:=old_date+1;end loop;
while extract(isodow from new_date) in (6,7) loop new_date:=new_date+1;end loop;
if exists(select 1 from holidays where holiday_date in(old_date,new_date,new_date+1)) then raise exception 'holiday fixture collision';end if;
p:=public.preview_leave_entry(emp,t1,old_date,old_date,'full',null);
eid:=public.save_leave_entry(gen_random_uuid(),emp,t1,old_date,old_date,'full','P6 rollback move',p->>'fingerprint',null,null,null);
select updated_at into rev from leave_entries where id=eid;
p:=public.preview_leave_entry(emp,t2,new_date,new_date,'morning',eid);
perform public.save_leave_entry(gen_random_uuid(),emp,t2,new_date,new_date,'morning','P6 rollback moved',p->>'fingerprint',eid,rev,'P6 move year/type');
if exists(select 1 from leave_entries where employee_id=emp and leave_type_id=t1 and start_date<='2098-12-31' and end_date>='2098-01-01') then raise exception 'old history filter not cleared';end if;
if not exists(select 1 from leave_entries where id=eid and leave_type_id=t2 and start_date<='2099-12-31' and end_date>='2099-01-01') then raise exception 'new history filter missing';end if;
if exists(select 1 from leave_entry_days d join leave_entries e on e.id=d.leave_entry_id where e.employee_id=emp and e.status='recorded' and (e.leave_type_id=t1 or extract(year from d.leave_date)=2098)) then raise exception 'old usage not cleared';end if;
if (select sum(d.days) from leave_entry_days d join leave_entries e on e.id=d.leave_entry_id where e.employee_id=emp and e.leave_type_id=t2 and e.status='recorded' and extract(year from d.leave_date)=2099) is distinct from 0.5 then raise exception 'new usage incorrect';end if;
select updated_at into rev from leave_entitlements where employee_id=emp and leave_type_id=t2 and year=2099;
ent:=public.save_leave_entitlement(emp,t2,2099,5,'P6 rollback quota',rev);
if ent.quota_days is distinct from 5 or 5-(select sum(days) from leave_entry_days where leave_entry_id=eid) is distinct from 4.5 then raise exception 'quota change aggregate mismatch';end if;
hol:=public.save_holiday(null,new_date,'P6 rollback holiday',null);
hol:=public.save_holiday(hol.id,new_date+1,'P6 rollback holiday moved',hol.updated_at);
perform public.delete_holiday(hol.id,hol.updated_at);
if (select sum(days) from leave_entry_days where leave_entry_id=eid) is distinct from 0.5 then raise exception 'holiday mutated stored charges';end if;
select jsonb_build_object('entry',to_jsonb(e),'days',(select jsonb_agg(to_jsonb(d) order by d.id) from leave_entry_days d where d.leave_entry_id=eid),'audit',(select count(*) from audit_events where record_id=eid),'requests',(select count(*) from leave_entry_requests where entry_id=eid)) into before_state from leave_entries e where id=eid;
select updated_at into rev from leave_entries where id=eid;
p:=public.preview_leave_entry(emp,t2,new_date,new_date,'afternoon',eid);
begin
perform public.save_leave_entry(gen_random_uuid(),emp,t2,new_date,new_date,'afternoon','P6 fail',p->>'fingerprint',eid,rev-interval '1 day','P6 stale revision');
raise exception using errcode='22000',message='stale mutation accepted';
exception when sqlstate 'P0001' then get stacked diagnostics message=message_text; if message<>'revision_conflict' then raise exception 'unexpected failure %',message;end if;end;
select jsonb_build_object('entry',to_jsonb(e),'days',(select jsonb_agg(to_jsonb(d) order by d.id) from leave_entry_days d where d.leave_entry_id=eid),'audit',(select count(*) from audit_events where record_id=eid),'requests',(select count(*) from leave_entry_requests where entry_id=eid)) into after_state from leave_entries e where id=eid;
if before_state<>after_state then raise exception 'failed mutation changed entry/days/audit/ledger';end if;
end $$;
reset role;
select 'PASS: old type/year usage cleared; new type/year usage 0.5; quota change remaining4.5; holiday create/move/delete preserves charges; failed mutation preserves entry/days/audit/ledger' as result;
rollback;
