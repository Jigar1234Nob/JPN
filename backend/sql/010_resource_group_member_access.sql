-- JPN resource-group restrictions by private member groups.
-- Run after migrations 001 through 009.
-- A resource group with no assigned member groups remains visible to every account
-- that already passes the global download gate. Once one or more groups are assigned,
-- only members of at least one selected member group can see/download its resources.

create table if not exists public.jpn_download_group_member_groups (
  download_group_id uuid not null references public.jpn_download_groups(id) on delete cascade,
  member_group_id uuid not null references public.jpn_member_groups(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (download_group_id, member_group_id)
);

create index if not exists jpn_download_group_member_groups_member_idx
  on public.jpn_download_group_member_groups(member_group_id);

alter table public.jpn_download_group_member_groups enable row level security;
revoke all on public.jpn_download_group_member_groups from anon, authenticated;
grant all on public.jpn_download_group_member_groups to service_role;

create or replace function public.jpn_current_user_can_access_download_group(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $jpn$
  select
    target_group_id is null
    or (select auth.jwt()->'app_metadata'->>'role') = 'admin'
    or not exists (
      select 1
      from public.jpn_download_group_member_groups required
      where required.download_group_id = target_group_id
    )
    or exists (
      select 1
      from public.jpn_download_group_member_groups required
      join public.jpn_member_group_members membership
        on membership.group_id = required.member_group_id
      where required.download_group_id = target_group_id
        and membership.user_id = (select auth.uid())
    );
$jpn$;

revoke all on function public.jpn_current_user_can_access_download_group(uuid) from public, anon;
grant execute on function public.jpn_current_user_can_access_download_group(uuid) to authenticated;

drop policy if exists "Authorised users can list published JPN downloads" on public.jpn_downloads;
create policy "Authorised users can list published JPN downloads"
on public.jpn_downloads for select to authenticated
using (
  published = true
  and public.jpn_current_account_enabled()
  and public.jpn_current_user_download_access()
  and public.jpn_current_user_can_access_download_group(group_id)
);

drop policy if exists "Authorised users can list published JPN download groups" on public.jpn_download_groups;
create policy "Authorised users can list published JPN download groups"
on public.jpn_download_groups for select to authenticated
using (
  published = true
  and public.jpn_current_account_enabled()
  and public.jpn_current_user_download_access()
  and public.jpn_current_user_can_access_download_group(id)
);

-- Direct private-storage reads must obey the same group restrictions, not just API links.
drop policy if exists "Authorised users can download JPN files" on storage.objects;
create policy "Authorised users can download JPN files"
on storage.objects for select to authenticated
using (
  bucket_id = 'jpn-private-downloads'
  and public.jpn_current_account_enabled()
  and public.jpn_current_user_download_access()
  and exists (
    select 1
    from public.jpn_downloads d
    where d.bucket = storage.objects.bucket_id
      and d.object_path = storage.objects.name
      and d.published = true
      and public.jpn_current_user_can_access_download_group(d.group_id)
  )
);

comment on table public.jpn_download_group_member_groups is
  'Member groups allowed to access each JPN resource/download group; an empty assignment list means unrestricted within the global download gate.';
