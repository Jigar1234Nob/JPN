-- JPN admin directory and first/last name search.
-- Run after migrations 001 through 012 in the Supabase SQL Editor.

drop function if exists public.jpn_admin_search_users(text);

create function public.jpn_admin_search_users(
  search_query text default '',
  result_limit integer default 100,
  result_offset integer default 0
)
returns table(
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  created_at timestamptz,
  paid boolean,
  expires_at timestamptz,
  plan text,
  disabled boolean,
  plan_request text,
  plan_request_status text,
  plan_requested_at text,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_query text := trim(coalesce(search_query, ''));
begin
  if (auth.jwt()->'app_metadata'->>'role') is distinct from 'admin'
     or not public.jpn_current_account_enabled() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if length(normalized_query) > 254 then
    raise exception 'Search query is too long';
  end if;
  if result_limit < 1 or result_limit > 100 then
    raise exception 'Page size must be between 1 and 100';
  end if;
  if result_offset < 0 then
    raise exception 'Page offset cannot be negative';
  end if;

  return query
  select
    u.id,
    u.email::text,
    coalesce(u.raw_user_meta_data->>'first_name', ''),
    coalesce(u.raw_user_meta_data->>'last_name', ''),
    u.created_at,
    coalesce(e.paid and (e.expires_at is null or e.expires_at > now()), false),
    e.expires_at,
    coalesce(e.plan, case when e.paid then 'basic' else 'free' end),
    (coalesce(u.raw_app_meta_data->>'jpn_disabled', 'false') = 'true')
      or (u.banned_until is not null and u.banned_until > now()),
    u.raw_user_meta_data->>'jpn_plan_request',
    u.raw_user_meta_data->>'jpn_plan_request_status',
    u.raw_user_meta_data->>'jpn_plan_requested_at',
    count(*) over()::bigint
  from auth.users as u
  left join public.jpn_entitlements as e on e.user_id = u.id
  where normalized_query = ''
     or coalesce(u.email, '') ilike '%' || normalized_query || '%'
     or coalesce(u.raw_user_meta_data->>'first_name', '') ilike '%' || normalized_query || '%'
     or coalesce(u.raw_user_meta_data->>'last_name', '') ilike '%' || normalized_query || '%'
     or concat_ws(' ', u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'last_name') ilike '%' || normalized_query || '%'
     or u.id::text ilike '%' || normalized_query || '%'
  order by u.created_at desc
  limit result_limit offset result_offset;
end;
$$;

revoke all on function public.jpn_admin_search_users(text, integer, integer) from public, anon;
grant execute on function public.jpn_admin_search_users(text, integer, integer) to authenticated;
