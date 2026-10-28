-- JPN administrator-managed member groups.
-- Run after migrations 001 through 008.
create table if not exists public.jpn_member_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists jpn_member_groups_name_unique
  on public.jpn_member_groups (lower(trim(name)));

create table if not exists public.jpn_member_group_members (
  group_id uuid not null references public.jpn_member_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null,
  primary key (group_id, user_id)
);

create index if not exists jpn_member_group_members_user_idx
  on public.jpn_member_group_members(user_id);

alter table public.jpn_member_groups enable row level security;
alter table public.jpn_member_group_members enable row level security;
revoke all on public.jpn_member_groups from anon, authenticated;
revoke all on public.jpn_member_group_members from anon, authenticated;
grant all on public.jpn_member_groups to service_role;
grant all on public.jpn_member_group_members to service_role;

comment on table public.jpn_member_groups is
  'Private administrator-managed groups used to organise JPN member accounts.';
comment on table public.jpn_member_group_members is
  'Membership assignments for private JPN member groups; managed by the backend service role.';
