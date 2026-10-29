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


-- Seed the current dashboard catalogue once. Re-running this migration will not duplicate names.
insert into public.jpn_compatibility_entries (name,status,category,details,notes,link)
select v.name,v.status,v.category,v.details,v.notes,v.link
from (values
 ('v2rayN','works','JPN client','The documented client used to import your JPN configuration and connect.','Use the build that matches your Windows architecture.','https://github.com/2dust/v2rayN/releases'),
 ('Discord app (without Proxifier)','works','Desktop app','Listed as working through the normal JPN connection without requiring Proxifier.','Keep v2rayN connected. Availability can still depend on your network and Discord service status.','https://discord.com/download'),
 ('Steam app (without Proxifier)','works','Desktop app / gaming','Listed as working through the normal JPN connection without requiring Proxifier.','Keep v2rayN connected. Store, downloads, sign-in, and individual games can behave differently depending on network rules.','https://store.steampowered.com/about/'),
 ('Microsoft Edge on Windows ARM64','works','Browser','Listed in JPN dashboard setup guidance for browser-based setup on Windows ARM64.','Keep v2rayN running and connected while browsing.',null),
 ('Microsoft Edge on Windows x64','works','Browser','Listed in JPN dashboard setup guidance for browser-based setup on Windows x64.','Keep v2rayN running and connected while browsing.',null),
 ('Google Chrome on Windows x64','works','Browser','The JPN setup guide documents Chrome support for the browser-only setup on x64 Windows.','This is setup guidance, not a guarantee for every extension or network.',null),
 ('Google Chrome on Windows ARM64 (with Proxifier)','works','Browser / Optional routing','Listed as supported when Proxifier is configured to route Chrome traffic through the JPN connection via v2rayN.','Proxifier must be configured correctly and v2rayN must be connected. This does not guarantee every site or network will work.','https://www.proxifier.com/download/'),
 ('Minecraft Java Edition (with Proxifier)','works','Game / Optional routing','Listed as supported when Proxifier routes the Minecraft Java launcher and Java runtime process used by the game through the JPN connection.','Configure rules for the actual Java process (often javaw.exe), keep v2rayN connected, and test on your network. This is not a guarantee for every server.','https://www.proxifier.com/download/'),
 ('Roblox','unsupported','Game','Roblox is marked unsupported for this JPN setup.','Do not rely on JPN or Proxifier to make Roblox work.',null),
 ('Proxifier','limited','Optional routing','Optional setup can route many compatible desktop applications through v2rayN, but it is not a full-device VPN and some applications may not work.','Broad rules can interrupt apps or local-network access. Test carefully.','https://www.proxifier.com/download/'),
 ('Other websites and applications','untested','General compatibility','JPN has not verified every third-party website, desktop application, game, or streaming service.','Report the app name, device, operating system, and error details to Support.',null)
) as v(name,status,category,details,notes,link)
where not exists (select 1 from public.jpn_compatibility_entries e where lower(e.name)=lower(v.name));

grant select, insert, update, delete on public.jpn_compatibility_entries to authenticated;
