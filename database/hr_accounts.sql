create table hr_private.account_invites (
 email text primary key check(email=lower(btrim(email)) and position('@' in email)>1),
 role text not null check(role in ('owner','hr')),
 is_active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table hr_private.account_invites enable row level security;
revoke all on hr_private.account_invites from public,anon,authenticated;

-- This trigger runs only for Supabase-managed Auth changes, never as a callable API.
create function hr_private.sync_authorized_account() returns trigger
language plpgsql security definer set search_path='' as $$
declare permitted_role text;
begin
 select role into permitted_role from hr_private.account_invites
 where email=lower(btrim(new.email)) and is_active;
 if TG_OP='INSERT' and permitted_role is null then
  raise exception 'Account registration is restricted to invited users' using errcode='42501';
 end if;
 if permitted_role is not null and new.email_confirmed_at is not null then
  insert into public.app_users(id,role,is_active) values(new.id,permitted_role,true)
  on conflict(id) do update set role=excluded.role,is_active=true;
 else
  update public.app_users set is_active=false where id=new.id;
 end if;
 return new;
end $$;
revoke all on function hr_private.sync_authorized_account() from public,anon,authenticated;
create trigger hr_authorized_account_created after insert on auth.users
for each row execute function hr_private.sync_authorized_account();
create trigger hr_authorized_account_changed after update of email,email_confirmed_at on auth.users
for each row execute function hr_private.sync_authorized_account();
create policy deny_client_access on hr_private.account_invites for all to anon, authenticated using (false) with check (false);
