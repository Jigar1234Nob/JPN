-- JPN site announcement banners
-- Run once in the Supabase SQL Editor connected to the JPN backend project.
create table if not exists public.jpn_site_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 500),
  link_url text,
  link_label text,
  style text not null default 'info' check (style in ('info','success','warning','promo')),
  enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jpn_site_announcements_link_pair check (
    (link_url is null and link_label is null) or
    (link_url is not null and link_label is not null)
  )
);
create index if not exists jpn_site_announcements_active_idx
  on public.jpn_site_announcements (enabled, sort_order, created_at desc);
alter table public.jpn_site_announcements enable row level security;
-- All reads and writes are performed by the JPN backend using its service-role client.
-- No browser-facing table policies are created.
