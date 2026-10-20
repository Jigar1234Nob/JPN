-- Run this script in Supabase Dashboard > SQL Editor.
-- Each signed-in user can read and update only their own profile.
create table if not exists public.jpn_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jpn_profiles enable row level security;
revoke all on public.jpn_profiles from anon;
grant select, insert, update on public.jpn_profiles to authenticated;

drop policy if exists "Users can read their own JPN profile" on public.jpn_profiles;
create policy "Users can read their own JPN profile"
  on public.jpn_profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can create their own JPN profile" on public.jpn_profiles;
create policy "Users can create their own JPN profile"
  on public.jpn_profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own JPN profile" on public.jpn_profiles;
create policy "Users can update their own JPN profile"
  on public.jpn_profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create index if not exists jpn_profiles_updated_at_idx
  on public.jpn_profiles (updated_at desc);

-- Profile rows are created on first profile save. Auth identity remains in auth.users.
-- Never put a Supabase service-role/secret key in the browser or this repository.