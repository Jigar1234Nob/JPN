-- Restrict JPN downloads to active Premium and Enterprise memberships.
-- Run this migration in the Supabase SQL Editor after migrations 001-004.

drop policy if exists "Paid members can list published JPN downloads" on public.jpn_downloads;
create policy "Premium and Enterprise members can list published JPN downloads"
on public.jpn_downloads for select to authenticated
using (
  published = true
  and public.jpn_current_account_enabled()
  and exists (
    select 1 from public.jpn_entitlements e
    where e.user_id = (select auth.uid())
      and e.paid = true
      and e.plan in ('premium', 'enterprise')
      and (e.expires_at is null or e.expires_at > now())
  )
);

drop policy if exists "Paid members can list published JPN download groups" on public.jpn_download_groups;
create policy "Premium and Enterprise members can list published JPN download groups"
on public.jpn_download_groups for select to authenticated
using (
  published = true
  and public.jpn_current_account_enabled()
  and exists (
    select 1 from public.jpn_entitlements e
    where e.user_id = (select auth.uid())
      and e.paid = true
      and e.plan in ('premium', 'enterprise')
      and (e.expires_at is null or e.expires_at > now())
  )
);

drop policy if exists "Paid members can download JPN files" on storage.objects;
create policy "Premium and Enterprise members can download JPN files"
on storage.objects for select to authenticated
using (
  bucket_id = 'jpn-private-downloads'
  and public.jpn_current_account_enabled()
  and exists (
    select 1 from public.jpn_entitlements e
    where e.user_id = (select auth.uid())
      and e.paid = true
      and e.plan in ('premium', 'enterprise')
      and (e.expires_at is null or e.expires_at > now())
  )
);
