-- Exchange production hardening.
-- Run AFTER the Stage 1, Stage 2 and Stage 4 migrations.
-- Client-side UI must use the protected RPCs for economic mutations.

-- Prevent users from creating free tasks or promotions directly through the REST API.
drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "promotions_insert_own" on public.promotions;

-- Credit changes and role changes must never be writable by a normal user.
create or replace function public.protect_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id then
    new.credits := old.credits;
    new.role := old.role;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_profile_sensitive_fields() from public, anon, authenticated;

drop trigger if exists protect_profile_sensitive_fields on public.profiles;
create trigger protect_profile_sensitive_fields
before update on public.profiles
for each row execute function public.protect_profile_sensitive_fields();

-- Keep verification submissions editable by their owner so a rejected/pending
-- proof can be replaced without exposing reviewer fields to the client.
drop policy if exists "task_verifications_update_own" on public.task_verifications;
create policy "task_verifications_update_own"
on public.task_verifications for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Notification records are server-generated. Clients may only change read_at.
create or replace function public.protect_notification_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := old.user_id;
  new.type := old.type;
  new.title := old.title;
  new.body := old.body;
  new.created_at := old.created_at;
  return new;
end;
$$;

revoke all on function public.protect_notification_fields() from public, anon, authenticated;

drop trigger if exists protect_notification_fields on public.notifications;
create trigger protect_notification_fields
before update on public.notifications
for each row execute function public.protect_notification_fields();

-- Use bracket expressions so PostgreSQL regex escaping cannot accidentally
-- turn the platform URL check into a different pattern.
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
  if v_url !~ '^https://[^[:space:]]+$' then
    return false;
  end if;

  if p_platform = 'Instagram' then
    return v_url ~ '^https://(www[.])?instagram[.]com(/|$)';
  elsif p_platform = 'TikTok' then
    return v_url ~ '^https://(www[.])?tiktok[.]com(/|$)';
  elsif p_platform = 'YouTube' then
    return v_url ~ '^https://(www[.])?youtube[.]com(/|$)'
       or v_url ~ '^https://youtu[.]be(/|$)';
  elsif p_platform = 'X' then
    return v_url ~ '^https://(www[.])?(x[.]com|twitter[.]com)(/|$)';
  elsif p_platform = 'Facebook' then
    return v_url ~ '^https://(www[.])?facebook[.]com(/|$)';
  end if;

  return false;
end;
$$;

revoke all on function public.exchange_valid_target_url(text,text) from public, anon, authenticated;

after??