drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "promotions_insert_own" on public.promotions;

drop policy if exists "profiles_update_own" on public.profiles;

create or replace function public.update_my_profile(
  p_username text,
  p_display_name text,
  p_avatar_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_username is null or length(trim(p_username)) < 3 then raise exception 'Username is too short'; end if;
  update public.profiles
  set username=trim(p_username),
      display_name=coalesce(nullif(trim(p_display_name),''),trim(p_username)),
      avatar_url=nullif(trim(p_avatar_url),''),
      updated_at=now()
  where id=v_user;
  if not found then raise exception 'Profile not found'; end if;
end;
$$;

revoke all on function public.update_my_profile(text,text,text) from public;
grant execute on function public.update_my_profile(text,text,text) to authenticated;

create or replace function public.exchange_valid_target_url(
  p_platform text,
  p_url text
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_url text := lower(trim(coalesce(p_url,'')));
begin
  if v_url !~ '^https://[^[:space:]]+$' then return false; end if;
  if p_platform='Instagram' then return v_url ~ '^https://(www[.])?instagram[.]com(/|$)'; end if;
  if p_platform='TikTok' then return v_url ~ '^https://(www[.])?tiktok[.]com(/|$)'; end if;
  if p_platform='YouTube' then return v_url ~ '^https://(www[.])?youtube[.]com(/|$)' or v_url ~ '^https://youtu[.]be(/|$)'; end if;
  if p_platform='X' then return v_url ~ '^https://(www[.])?(x[.]com|twitter[.]com)(/|$)'; end if;
  if p_platform='Facebook' then return v_url ~ '^https://(www[.])?facebook[.]com(/|$)'; end if;
  return false;
end;
$$;

revoke all on function public.exchange_valid_target_url(text,text) from public,anon,authenticated;
