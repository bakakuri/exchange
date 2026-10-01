-- 013_audit_logs.sql
-- Immutable record of admin and security-relevant actions. Only written
-- via log_audit_event(), called internally by the SECURITY DEFINER
-- functions in 015_functions.sql - never inserted directly by a client,
-- and never updated or deleted once written.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is 'Immutable audit trail. Written only through log_audit_event() in 015_functions.sql.';

create or replace function public.forbid_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'AUDIT_LOG_IMMUTABLE: audit_logs rows cannot be updated or deleted'
    using errcode = 'P0001';
end;
$$;

create trigger trg_audit_logs_no_update
  before update on public.audit_logs
  for each row execute function public.forbid_audit_log_mutation();

create trigger trg_audit_logs_no_delete
  before delete on public.audit_logs
  for each row execute function public.forbid_audit_log_mutation();

create or replace function public.log_audit_event(
  p_actor_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_before_data jsonb,
  p_after_data jsonb,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, target_type, target_id, before_data, after_data, reason)
  values (p_actor_id, p_action, p_target_type, p_target_id, p_before_data, p_after_data, p_reason);
end;
$$;
