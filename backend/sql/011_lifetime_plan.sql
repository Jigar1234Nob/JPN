-- Add JPN Lifetime membership and retire the Basic tier.
-- Run this migration in the Supabase SQL Editor after migration 004.

alter table public.jpn_entitlements
  drop constraint if exists jpn_entitlements_plan_check;

-- Existing Basic members keep paid access and are mapped to Premium.
update public.jpn_entitlements
set plan = 'premium'
where plan = 'basic';

alter table public.jpn_entitlements
  add constraint jpn_entitlements_plan_check
  check (plan in ('free', 'premium', 'lifetime', 'enterprise'));

create or replace function public.jpn_admin_set_plan(
  target_user_id uuid,
  target_plan text,
  entitlement_expires_at timestamptz default null
)
returns table(
  user_id uuid,
  paid boolean,
  plan text,
  expires_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $jpn$
begin
  if (auth.jwt()->'app_metadata'->>'role') is distinct from 'admin'
     or not public.jpn_current_account_enabled() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if target_plan not in ('free', 'premium', 'lifetime', 'enterprise') then
    raise exception 'Choose No access, Premium, Lifetime, or Enterprise';
  end if;

  if not exists (select 1 from auth.users u where u.id = target_user_id) then
    raise exception 'Account not found';
  end if;

  if target_plan not in ('free', 'lifetime')
     and entitlement_expires_at is not null
     and entitlement_expires_at <= now() then
    raise exception 'Expiry must be in the future';
  end if;

  insert into public.jpn_entitlements(
    user_id, paid, plan, expires_at, updated_at, updated_by
  )
  values (
    target_user_id,
    target_plan <> 'free',
    target_plan,
    case when target_plan in ('free', 'lifetime') then null else entitlement_expires_at end,
    now(),
    auth.uid()
  )
  on conflict (user_id) do update
    set paid = excluded.paid,
        plan = excluded.plan,
        expires_at = excluded.expires_at,
        updated_at = now(),
        updated_by = auth.uid();

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'jpn_plan_request_status',
      case when target_plan = 'free' then 'reviewed' else 'approved' end
    )
  where id = target_user_id;

  return query
    select e.user_id, e.paid, e.plan, e.expires_at, e.updated_at
    from public.jpn_entitlements e
    where e.user_id = target_user_id;
end;
$jpn$;

revoke all on function public.jpn_admin_set_plan(uuid, text, timestamptz) from public, anon;
grant execute on function public.jpn_admin_set_plan(uuid, text, timestamptz) to authenticated;
