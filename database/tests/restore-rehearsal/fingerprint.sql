-- Emit row counts and stable checksums without printing row values.
create function pg_temp.hr_fingerprint() returns table(object_name text, fingerprint text)
language plpgsql as $$
declare r record; value text;
begin
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','hr_private','auth') and c.relkind='r' order by 1,2 loop
    execute format('select count(*)::text || '':'' || md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text),'''')) from %I.%I t',r.nspname,r.relname) into value;
    object_name:=r.nspname||'.'||r.relname; fingerprint:=value; return next;
  end loop;
end $$;
select * from pg_temp.hr_fingerprint();
-- Compare effective ACL entries, not array order or NULL versus explicit defaults.
create function pg_temp.hr_acl(acl aclitem[], kind "char", owner_id oid) returns text
language sql stable as $$
  select coalesce(string_agg(grantor::text||':'||grantee::text||':'||privilege_type||':'||is_grantable::text,';' order by grantor,grantee,privilege_type,is_grantable),'')
  from aclexplode(coalesce(acl,acldefault(kind,owner_id)))
$$;
select 'security:'||split_part(value,':',1)||':'||split_part(value,':',2), md5(value) from (
  select 'table:'||n.nspname||'.'||c.relname||':'||c.relrowsecurity||':'||c.relforcerowsecurity||':'||pg_temp.hr_acl(c.relacl,'r',c.relowner) value
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','hr_private','auth') and c.relkind='r'
  union all select 'schema:'||nspname||':'||pg_temp.hr_acl(nspacl,'n',nspowner) from pg_namespace where nspname in ('public','hr_private','auth')
  union all select 'function:'||n.nspname||'.'||p.proname||':'||pg_get_functiondef(p.oid)||':'||pg_temp.hr_acl(p.proacl,'f',p.proowner)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','hr_private','auth') and p.prokind='f'
  union all select 'policy:'||schemaname||'.'||tablename||':'||policyname||':'||permissive||':'||roles::text||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies where schemaname in ('public','hr_private','auth')
  union all select 'constraint:'||n.nspname||'.'||c.relname||':'||k.conname||':'||pg_get_constraintdef(k.oid)||':'||k.convalidated
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','hr_private','auth')
  union all select 'trigger:'||n.nspname||'.'||c.relname||':'||pg_get_triggerdef(t.oid)||':'||t.tgenabled::text
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','hr_private','auth') and not t.tgisinternal
) catalog order by value;
