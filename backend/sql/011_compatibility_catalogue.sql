-- JPN What Works? compatibility catalogue.
-- Run after migrations 001 through 010 in Supabase SQL Editor.

create table if not exists public.jpn_compatibility_entries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  status text not null check (status in ('works', 'limited', 'unsupported', 'untested')),
  category text not null check (char_length(category) between 1 and 80),
  details text not null check (char_length(details) between 1 and 1200),
  notes text not null check (char_length(notes) between 1 and 600),
  link text null check (link is null or (char_length(link) <= 500 and link ~* '^https://')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jpn_compatibility_entries_created_idx
  on public.jpn_compatibility_entries (created_at asc);

alter table public.jpn_compatibility_entries enable row level security;

drop policy if exists "Signed-in users can read compatibility entries" on public.jpn_compatibility_entries;
create policy "Signed-in users can read compatibility entries"
  on public.jpn_compatibility_entries for select to authenticated
  using (true);

drop policy if exists "JPN admins can insert compatibility entries" on public.jpn_compatibility_entries;
create policy "JPN admins can insert compatibility entries"
  on public.jpn_compatibility_entries for insert to authenticated
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin' and created_by = auth.uid());

drop policy if exists "JPN admins can update compatibility entries" on public.jpn_compatibility_entries;
create policy "JPN admins can update compatibility entries"
  on public.jpn_compatibility_entries for update to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin')
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin' and updated_by = auth.uid());

drop policy if exists "JPN admins can delete compatibility entries" on public.jpn_compatibility_entries;
create policy "JPN admins can delete compatibility entries"
  on public.jpn_compatibility_entries for delete to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

grant select, insert, update, delete on public.jpn_compatibility_entries to authenticated;
