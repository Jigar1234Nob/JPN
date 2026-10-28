-- Remove Basic from new JPN plan assignments while preserving existing legacy entitlements.
-- Apply this migration in the Supabase SQL Editor after migration 006.

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
as $$
#variable_conflict use_column
begin
  if (auth.jwt()->'app_metadata'->>'role') is distinct from 'admin'
     or not public.jpn_current_account_enabled() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if target_plan not in ('free','premium','enterprise') then
    raise exception 'Choose No access, Premium, or Enterprise';
  end if;

  if not exists (
    select 1 from auth.users as u where u.id = target_user_id
  ) then
    raise exception 'Account not found';
  end if;

  if target_plan <> 'free'
     and entitlement_expires_at is not null
     and entitlement_expires_at <= now() then
    raise exception 'Expiry must be in the future';
  end if;

  insert into public.jpn_entitlements as ent
    (user_id, paid, plan, expires_at, updated_at, updated_by)
  values (
    target_user_id,
    target_plan <> 'free',
    target_plan,
    case when target_plan = 'free' then null else entitlement_expires_at end,
    now(),
    auth.uid()
  )
  on conflict (user_id) do update
  set paid = excluded.paid,
      plan = excluded.plan,
      expires_at = excluded.expires_at,
      updated_at = now(),
      updated_by = auth.uid();

  update auth.users as u
  set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'jpn_plan_request_status',
      case when target_plan = 'free' then 'reviewed' else 'approved' end
    )
  where u.id = target_user_id;

  return query
  select ent.user_id, ent.paid, ent.plan, ent.expires_at, ent.updated_at
  from public.jpn_entitlements as ent
  where ent.user_id = target_user_id;
end;
$$;

revoke all on function public.jpn_admin_set_plan(uuid, text, timestamptz)
  from public, anon;
grant execute on function public.jpn_admin_set_plan(uuid, text, timestamptz)
  to authenticated;
