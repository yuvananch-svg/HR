-- Minimal Supabase Auth surface for isolated vanilla PostgreSQL regression.
-- This is test scaffolding, not a replacement for Supabase Auth.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    execute 'create role authenticated nologin';
  end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated;

do $$ begin
  if to_regclass('auth.users') is null then
    execute $ddl$
      create table auth.users (
        id uuid primary key,
        email text unique,
        email_confirmed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $ddl$;
  end if;
  if to_regprocedure('auth.uid()') is null then
    execute $ddl$
      create function auth.uid() returns uuid
      language sql stable security invoker set search_path=''
      as $fn$
        select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
      $fn$
    $ddl$;
  end if;
end $$;
grant execute on function auth.uid() to anon, authenticated;
