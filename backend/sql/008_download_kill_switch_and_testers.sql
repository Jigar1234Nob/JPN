-- JPN global download kill switch and explicit tester allowlist.
-- Run after migrations 001 through 007.
create table if not exists public.jpn_download_access_settings (
  id integer primary key check (id = 1),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.jpn_download_access_settings (id, enabled)
values (1, false)
on conflict (id) do nothing;

create table if not exists public.jpn_download_testers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_by uuid,
  created_at timestamptz not null default now()
);

alter table public.jpn_download_access_settings enable row level security;
alter table public.jpn_download_testers enable row level security;
revoke all on public.jpn_download_access_settings from anon, authenticated;
revoke all on public.jpn_download_testers from anon, authenticated;

create or replace function public.jpn_current_user_download_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $jpn$
  select exists (
    select 1 from public.jpn_download_testers t
    where t.user_id = (select auth.uid())
  )
  or (
    coalesce((select s.enabled from public.jpn_download_access_settings s where s.id = 1), false)
    and (
      (select u.raw_app_meta_data->>'role' from auth.users u where u.id = (select auth.uid())) = 'admin'
      or exists (
        select 1 from public.jpn_entitlements e
        where e.user_id = (select auth.uid())
          and e.paid = true
          and lower(coalesce(e.plan, '')) in ('premium','enterprise')
          and (e.expires_at is null or e.expires_at > now())
      )
    )
  )
$jpn$;
revoke all on function public.jpn_current_user_download_access() from public, anon;
grant execute on function public.jpn_current_user_download_access() to authenticated;

drop policy if exists "Paid members can list published JPN downloads" on public.jpn_downloads;
create policy "Authorised users can list published JPN downloads"
on public.jpn_downloads for select to authenticated
using (published = true and public.jpn_current_account_enabled() and public.jpn_current_user_download_access());

drop policy if exists "Paid members can list published JPN download groups" on public.jpn_download_groups;
create policy "Authorised users can list published JPN download groups"
on public.jpn_download_groups for select to authenticated
using (published = true and public.jpn_current_account_enabled() and public.jpn_current_user_download_access());

drop policy if exists "Paid members can download JPN files" on storage.objects;
create policy "Authorised users can download JPN files"
on storage.objects for select to authenticated
using (
  bucket_id = 'jpn-private-downloads'
  and public.jpn_current_account_enabled()
  and public.jpn_current_user_download_access()
);

-- The default is deliberately OFF. An administrator must explicitly enable general access.
