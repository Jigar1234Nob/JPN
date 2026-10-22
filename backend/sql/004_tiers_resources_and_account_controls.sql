-- JPN tier, resource groups, GitHub builds, account suspension, and Enterprise inquiries.
-- Run after 001_profiles.sql, 002_entitlements_and_downloads.sql, and 003_plan_requests.sql.

alter table public.jpn_entitlements
  add column if not exists plan text not null default 'free'
  check (plan in ('free','basic','premium','enterprise'));

update public.jpn_entitlements
set plan = case when paid then coalesce(nullif(plan,'free'),'basic') else 'free' end
where plan = 'free';

alter table public.jpn_downloads
  add column if not exists group_id uuid,
  add column if not exists github_url text;
alter table public.jpn_downloads alter column object_path drop not null;

-- Check the current account against live auth.users metadata, not just a possibly
-- stale JWT. This makes suspension effective for existing database/storage sessions.
create or replace function public.jpn_current_account_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $jpn$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid())
      and coalesce(u.raw_app_meta_data->>'jpn_disabled', 'false') <> 'true'
      and (u.banned_until is null or u.banned_until <= now())
  );
$jpn$;
revoke all on function public.jpn_current_account_enabled() from public, anon;
grant execute on function public.jpn_current_account_enabled() to authenticated;

drop policy if exists "Users can read their own JPN profile" on public.jpn_profiles;
create policy "Users can read their own JPN profile" on public.jpn_profiles for select to authenticated
using ((select auth.uid()) = id and public.jpn_current_account_enabled());
drop policy if exists "Users can create their own JPN profile" on public.jpn_profiles;
create policy "Users can create their own JPN profile" on public.jpn_profiles for insert to authenticated
with check ((select auth.uid()) = id and public.jpn_current_account_enabled());
drop policy if exists "Users can update their own JPN profile" on public.jpn_profiles;
create policy "Users can update their own JPN profile" on public.jpn_profiles for update to authenticated
using ((select auth.uid()) = id and public.jpn_current_account_enabled())
with check ((select auth.uid()) = id and public.jpn_current_account_enabled());

drop policy if exists "Users can read their own JPN entitlement" on public.jpn_entitlements;
create policy "Users can read their own JPN entitlement" on public.jpn_entitlements for select to authenticated
using ((select auth.uid()) = user_id and public.jpn_current_account_enabled());

drop policy if exists "Admins can read all JPN entitlements" on public.jpn_entitlements;
create policy "Admins can read all JPN entitlements" on public.jpn_entitlements for select to authenticated
using ((auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled());
drop policy if exists "Admins can manage JPN entitlements" on public.jpn_entitlements;
create policy "Admins can manage JPN entitlements" on public.jpn_entitlements for all to authenticated
using ((auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled())
with check ((auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled());

drop policy if exists "Paid members can list published JPN downloads" on public.jpn_downloads;
create policy "Paid members can list published JPN downloads" on public.jpn_downloads for select to authenticated
using (published = true and public.jpn_current_account_enabled() and exists (
  select 1 from public.jpn_entitlements e
  where e.user_id = (select auth.uid()) and e.paid = true
    and (e.expires_at is null or e.expires_at > now())
));

drop policy if exists "Paid members can download JPN files" on storage.objects;
create policy "Paid members can download JPN files" on storage.objects for select to authenticated
using (
  bucket_id = 'jpn-private-downloads'
  and public.jpn_current_account_enabled()
  and exists (
    select 1 from public.jpn_entitlements e
    where e.user_id = (select auth.uid()) and e.paid = true
      and (e.expires_at is null or e.expires_at > now())
  )
);

alter table public.jpn_downloads drop constraint if exists jpn_downloads_group_id_fkey;

create table if not exists public.jpn_download_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '',
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.jpn_downloads
  add constraint jpn_downloads_group_id_fkey
  foreign key (group_id) references public.jpn_download_groups(id) on delete set null;

alter table public.jpn_download_groups enable row level security;
revoke all on public.jpn_download_groups from anon;
grant select, insert, update, delete on public.jpn_download_groups to authenticated;
drop policy if exists "Paid members can list published JPN download groups" on public.jpn_download_groups;
create policy "Paid members can list published JPN download groups"
on public.jpn_download_groups for select to authenticated
using (published and public.jpn_current_account_enabled() and exists (
  select 1 from public.jpn_entitlements e
  where e.user_id=(select auth.uid()) and e.paid=true
    and (e.expires_at is null or e.expires_at>now())
));
drop policy if exists "Admins can manage JPN download groups" on public.jpn_download_groups;
create policy "Admins can manage JPN download groups"
on public.jpn_download_groups for all to authenticated
using ((auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled())
with check ((auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled());

drop policy if exists "Admins can manage JPN downloads" on public.jpn_downloads;
create policy "Admins can manage JPN downloads" on public.jpn_downloads for all to authenticated
using ((auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled())
with check ((auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled());

drop policy if exists "Admins can manage JPN private files" on storage.objects;
create policy "Admins can manage JPN private files" on storage.objects for all to authenticated
using (bucket_id='jpn-private-downloads' and (auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled())
with check (bucket_id='jpn-private-downloads' and (auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled());

revoke all on function public.jpn_admin_set_paid(uuid, boolean, timestamptz) from public, anon, authenticated;

create table if not exists public.jpn_enterprise_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null check (length(email) between 3 and 254),
  organization text not null default '',
  message text not null check (length(trim(message)) between 10 and 4000),
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
alter table public.jpn_enterprise_inquiries enable row level security;
revoke all on public.jpn_enterprise_inquiries from anon, authenticated;
grant insert on public.jpn_enterprise_inquiries to anon;
grant insert, select, update, delete on public.jpn_enterprise_inquiries to authenticated;
drop policy if exists "Anyone can submit an Enterprise inquiry" on public.jpn_enterprise_inquiries;
create policy "Anyone can submit an Enterprise inquiry"
on public.jpn_enterprise_inquiries for insert to anon, authenticated
with check (
  length(trim(name)) between 1 and 120 and length(email) between 3 and 254
  and length(trim(message)) between 10 and 4000 and status='new'
);
drop policy if exists "Admins can manage Enterprise inquiries" on public.jpn_enterprise_inquiries;
create policy "Admins can manage Enterprise inquiries"
on public.jpn_enterprise_inquiries for all to authenticated
using ((auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled())
with check ((auth.jwt()->'app_metadata'->>'role')='admin' and public.jpn_current_account_enabled());

drop function if exists public.jpn_admin_search_users(text);

create function public.jpn_admin_search_users(search_email text)
returns table(
 user_id uuid, email text, created_at timestamptz, paid boolean, expires_at timestamptz,
 plan text, disabled boolean, plan_request text, plan_request_status text, plan_requested_at text
)
language plpgsql security definer set search_path = ''
as $$
begin
 if (auth.jwt()->'app_metadata'->>'role') is distinct from 'admin' or not public.jpn_current_account_enabled() then
   raise exception 'Admin access required' using errcode='42501';
 end if;
 if length(trim(coalesce(search_email,'')))<3 then
   raise exception 'Enter at least 3 characters of an email address';
 end if;
 return query
 select u.id,u.email::text,u.created_at,
   coalesce(e.paid and (e.expires_at is null or e.expires_at>now()),false),
   e.expires_at,coalesce(e.plan,case when e.paid then 'basic' else 'free' end),
   (coalesce(u.raw_app_meta_data->>'jpn_disabled','false')='true')
      or (u.banned_until is not null and u.banned_until>now()),
   u.raw_user_meta_data->>'jpn_plan_request',
   u.raw_user_meta_data->>'jpn_plan_request_status',
   u.raw_user_meta_data->>'jpn_plan_requested_at'
 from auth.users u left join public.jpn_entitlements e on e.user_id=u.id
 where u.email ilike '%'||trim(search_email)||'%'
 order by u.created_at desc limit 25;
end;
$$;

create or replace function public.jpn_admin_set_plan(target_user_id uuid, target_plan text, entitlement_expires_at timestamptz default null)
returns table(user_id uuid, paid boolean, plan text, expires_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $
#variable_conflict use_column
begin
 if (auth.jwt()->'app_metadata'->>'role') is distinct from 'admin' or not public.jpn_current_account_enabled() then
   raise exception 'Admin access required' using errcode='42501';
 end if;
 if target_plan not in ('free','basic','premium','enterprise') then
   raise exception 'Choose Free, Basic, Premium, or Enterprise';
 end if;
 if not exists(select 1 from auth.users u where u.id=target_user_id) then
   raise exception 'Account not found';
 end if;
 if target_plan<>'free' and entitlement_expires_at is not null and entitlement_expires_at<=now() then
   raise exception 'Expiry must be in the future';
 end if;
 insert into public.jpn_entitlements(user_id,paid,plan,expires_at,updated_at,updated_by)
 values(target_user_id,target_plan<>'free',target_plan,
        case when target_plan='free' then null else entitlement_expires_at end,now(),auth.uid())
 on conflict(user_id) do update set paid=excluded.paid,plan=excluded.plan,
   expires_at=excluded.expires_at,updated_at=now(),updated_by=auth.uid();
 update auth.users
 set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
   || jsonb_build_object('jpn_plan_request_status', case when target_plan='free' then 'reviewed' else 'approved' end)
 where id=target_user_id;
 return query select e.user_id,e.paid,e.plan,e.expires_at,e.updated_at
 from public.jpn_entitlements e where e.user_id=target_user_id;
end;
$$;
revoke all on function public.jpn_admin_set_plan(uuid,text,timestamptz) from public,anon;
grant execute on function public.jpn_admin_set_plan(uuid,text,timestamptz) to authenticated;
