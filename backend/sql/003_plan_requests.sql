-- Show plan requests in the existing admin account search.
-- User metadata is editable by the account owner, so this is informational only.
-- The immutable app_metadata role and jpn_entitlements remain the access controls.
drop function if exists public.jpn_admin_search_users(text);

create function public.jpn_admin_search_users(search_email text)
returns table(
  user_id uuid,
  email text,
  created_at timestamptz,
  paid boolean,
  expires_at timestamptz,
  plan_request text,
  plan_request_status text,
  plan_requested_at text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (auth.jwt()->'app_metadata'->>'role') is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if length(trim(coalesce(search_email,''))) < 3 then
    raise exception 'Enter at least 3 characters of an email address';
  end if;

  return query
  select
    u.id,
    u.email::text,
    u.created_at,
    coalesce(e.paid and (e.expires_at is null or e.expires_at > now()), false),
    e.expires_at,
    u.raw_user_meta_data->>'jpn_plan_request',
    u.raw_user_meta_data->>'jpn_plan_request_status',
    u.raw_user_meta_data->>'jpn_plan_requested_at'
  from auth.users u
  left join public.jpn_entitlements e on e.user_id = u.id
  where u.email ilike '%' || trim(search_email) || '%'
  order by u.created_at desc
  limit 25;
end;
$$;

revoke all on function public.jpn_admin_search_users(text) from public, anon;
grant execute on function public.jpn_admin_search_users(text) to authenticated;
