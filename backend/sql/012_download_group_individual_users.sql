-- Direct per-user access for JPN download resource groups.
-- Run after migrations 009 and 010 in the same Supabase project used by Render.

create table if not exists public.jpn_download_group_users (
  download_group_id uuid not null references public.jpn_download_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (download_group_id, user_id)
);

create index if not exists jpn_download_group_users_user_idx
  on public.jpn_download_group_users(user_id);

alter table public.jpn_download_group_users enable row level security;
revoke all on public.jpn_download_group_users from anon, authenticated;
grant all on public.jpn_download_group_users to service_role;

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
    or (
      not exists (
        select 1 from public.jpn_download_group_member_groups required
        where required.download_group_id = target_group_id
      )
      and not exists (
        select 1 from public.jpn_download_group_users assigned
        where assigned.download_group_id = target_group_id
      )
    )
    or exists (
      select 1
      from public.jpn_download_group_member_groups required
      join public.jpn_member_group_members membership
        on membership.group_id = required.member_group_id
      where required.download_group_id = target_group_id
        and membership.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.jpn_download_group_users assigned
      where assigned.download_group_id = target_group_id
        and assigned.user_id = (select auth.uid())
    );
$jpn$;

revoke all on function public.jpn_current_user_can_access_download_group(uuid) from public, anon;
grant execute on function public.jpn_current_user_can_access_download_group(uuid) to authenticated;

comment on table public.jpn_download_group_users is
  'Individual accounts explicitly allowed to access a JPN download resource group. Direct assignments and assigned member groups are additive; if neither exists, all accounts passing the global download gate can access the group.';
