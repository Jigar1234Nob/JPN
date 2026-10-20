-- JPN paid entitlements, admin grants, and private downloads.
-- Run after 001_profiles.sql in Supabase SQL Editor.
create table if not exists public.jpn_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  paid boolean not null default false,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.jpn_entitlements enable row level security;
revoke all on public.jpn_entitlements from anon;
grant select on public.jpn_entitlements to authenticated;

drop policy if exists "Users can read their own JPN entitlement" on public.jpn_entitlements;
create policy "Users can read their own JPN entitlement"
 on public.jpn_entitlements for select to authenticated
 using ((select auth.uid()) = user_id);

drop policy if exists "Admins can read all JPN entitlements" on public.jpn_entitlements;
create policy "Admins can read all JPN entitlements"
 on public.jpn_entitlements for select to authenticated
 using ((auth.jwt()->'app_metadata'->>'role') = 'admin');

drop policy if exists "Admins can manage JPN entitlements" on public.jpn_entitlements;
create policy "Admins can manage JPN entitlements"
 on public.jpn_entitlements for all to authenticated
 using ((auth.jwt()->'app_metadata'->>'role') = 'admin')
 with check ((auth.jwt()->'app_metadata'->>'role') = 'admin');

create table if not exists public.jpn_downloads (
 id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
 title text not null,
 description text not null default '',
 version text not null default '',
 bucket text not null default 'jpn-private-downloads',
 object_path text not null,
 published boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.jpn_downloads enable row level security;
revoke all on public.jpn_downloads from anon;
grant select on public.jpn_downloads to authenticated;
grant insert, update, delete on public.jpn_downloads to authenticated;

drop policy if exists "Paid members can list published JPN downloads" on public.jpn_downloads;
create policy "Paid members can list published JPN downloads"
 on public.jpn_downloads for select to authenticated
 using (
   published = true and exists (
     select 1 from public.jpn_entitlements e
     where e.user_id = (select auth.uid())
       and e.paid = true
       and (e.expires_at is null or e.expires_at > now())
   )
 );

drop policy if exists "Admins can manage JPN downloads" on public.jpn_downloads;
create policy "Admins can manage JPN downloads"
 on public.jpn_downloads for all to authenticated
 using ((auth.jwt()->'app_metadata'->>'role') = 'admin')
 with check ((auth.jwt()->'app_metadata'->>'role') = 'admin');

-- Private bucket. Actual files are never placed in the public docs/ directory.
insert into storage.buckets (id, name, public, file_size_limit)
values ('jpn-private-downloads', 'jpn-private-downloads', false, 524288000)
on conflict (id) do update set public = false;

drop policy if exists "Paid members can download JPN files" on storage.objects;
create policy "Paid members can download JPN files"
 on storage.objects for select to authenticated
 using (
   bucket_id = 'jpn-private-downloads'
   and exists (
     select 1 from public.jpn_entitlements e
     where e.user_id = (select auth.uid())
       and e.paid = true
       and (e.expires_at is null or e.expires_at > now())
   )
 );

drop policy if exists "Admins can manage JPN private files" on storage.objects;
create policy "Admins can manage JPN private files"
 on storage.objects for all to authenticated
 using (
   bucket_id = 'jpn-private-downloads'
   and (auth.jwt()->'app_metadata'->>'role') = 'admin'
 )
 with check (
   bucket_id = 'jpn-private-downloads'
   and (auth.jwt()->'app_metadata'->>'role') = 'admin'
 );

-- Search auth users and grant/revoke paid status only for users with app_metadata.role=admin.
create or replace function public.jpn_admin_search_users(search_email text)
returns table(user_id uuid, email text, created_at timestamptz, paid boolean, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
 if (auth.jwt()->'app_metadata'->>'role') is distinct from 'admin' then
   raise exception 'Admin access required' using errcode = '42501';
 end if;
 if length(trim(coalesce(search_email,''))) < 3 then
   raise exception 'Enter at least 3 characters of an email address';
 end if;
 return query
 select u.id, u.email::text, u.created_at,
        coalesce(e.paid and (e.expires_at is null or e.expires_at > now()), false),
        e.expires_at
 from auth.users u
 left join public.jpn_entitlements e on e.user_id = u.id
 where u.email ilike '%' || trim(search_email) || '%'
 order by u.created_at desc
 limit 25;
end;
$$;

create or replace function public.jpn_admin_set_paid(target_user_id uuid, enable_paid boolean, entitlement_expires_at timestamptz default null)
returns table(user_id uuid, paid boolean, expires_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
 if (auth.jwt()->'app_metadata'->>'role') is distinct from 'admin' then
   raise exception 'Admin access required' using errcode = '42501';
 end if;
 if not exists (select 1 from auth.users u where u.id = target_user_id) then
   raise exception 'Account not found';
 end if;
 insert into public.jpn_entitlements(user_id, paid, expires_at, updated_at, updated_by)
 values (target_user_id, enable_paid, case when enable_paid then entitlement_expires_at else null end, now(), auth.uid())
 on conflict (user_id) do update
 set paid = excluded.paid, expires_at = excluded.expires_at,
     updated_at = now(), updated_by = auth.uid();
 return query select e.user_id, e.paid, e.expires_at, e.updated_at
 from public.jpn_entitlements e where e.user_id = target_user_id;
end;
$$;

revoke all on function public.jpn_admin_search_users(text) from public, anon;
revoke all on function public.jpn_admin_set_paid(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.jpn_admin_search_users(text) to authenticated;
grant execute on function public.jpn_admin_set_paid(uuid, boolean, timestamptz) to authenticated;

-- No service-role key is needed for these admin actions. Supabase validates the caller JWT,
-- and the security-definer functions independently verify the immutable app_metadata role.
