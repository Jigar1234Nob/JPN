-- JPN migration 016: repair announcements setup and admin plan updates.
-- Safe to run after the existing JPN migrations. This is deliberately self-contained:
-- it creates the announcements table if migration 015 has not yet been applied,
-- and replaces the plan RPC that migration 011 overwrote without its ambiguity fix.

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
-- The backend accesses this table with SUPABASE_SERVICE_ROLE_KEY.
-- No browser-facing policies are created.

-- Ensure the current plan values include Lifetime and exclude retired Basic.
alter table public.jpn_entitlements
  drop constraint if exists jpn_entitlements_plan_check;

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
#variable_conflict use_column
begin
  if (auth.jwt()->'app_metadata'->>'role') is distinct from 'admin'
     or not public.jpn_current_account_enabled() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if target_plan not in ('free', 'premium', 'lifetime', 'enterprise') then
    raise exception 'Choose No access, Premium, Lifetime, or Enterprise';
  end if;

  if not exists (
    select 1 from auth.users as account
    where account.id = target_user_id
  ) then
    raise exception 'Account not found';
  end if;

  if target_plan not in ('free', 'lifetime')
     and entitlement_expires_at is not null
     and entitlement_expires_at <= now() then
    raise exception 'Expiry must be in the future';
  end if;

  insert into public.jpn_entitlements as entitlement
    (user_id, paid, plan, expires_at, updated_at, updated_by)
  values (
    target_user_id,
    target_plan <> 'free',
    target_plan,
    case when target_plan in ('free', 'lifetime') then null else entitlement_expires_at end,
    now(),
    auth.uid()
  )
  on conflict on constraint jpn_entitlements_pkey do update
    set paid = excluded.paid,
        plan = excluded.plan,
        expires_at = excluded.expires_at,
        updated_at = now(),
        updated_by = auth.uid();

  update auth.users as account
  set raw_user_meta_data = coalesce(account.raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'jpn_plan_request_status',
      case when target_plan = 'free' then 'reviewed' else 'approved' end
    )
  where account.id = target_user_id;

  return query
    select entitlement.user_id, entitlement.paid, entitlement.plan,
           entitlement.expires_at, entitlement.updated_at
    from public.jpn_entitlements as entitlement
    where entitlement.user_id = target_user_id;
end;
$jpn$;

revoke all on function public.jpn_admin_set_plan(uuid, text, timestamptz)
  from public, anon;
grant execute on function public.jpn_admin_set_plan(uuid, text, timestamptz)
  to authenticated;

-- Tell PostgREST to refresh its table/function schema cache.
notify pgrst, 'reload schema';
