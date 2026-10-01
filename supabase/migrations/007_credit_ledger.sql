-- 007_credit_ledger.sql
-- The credit economy's single source of truth. Every balance change is a
-- row here; profiles.credits is only ever a cache kept in sync by the
-- same functions that insert these rows. The ledger is append-only: no
-- UPDATE or DELETE is permitted, even for admins - a correction is a new
-- row with type 'reversal', never an edit to history.

create type ledger_transaction_type as enum (
  'task_reward', 'campaign_reservation', 'campaign_refund',
  'referral_reward', 'signup_bonus', 'admin_adjustment',
  'reversal', 'penalty'
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  type ledger_transaction_type not null,
  description text not null default '',
  balance_after integer not null,
  related_task_id uuid references public.tasks(id),
  related_campaign_id uuid references public.campaigns(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint amount_not_zero check (amount <> 0)
);

comment on table public.credit_ledger is 'Append-only credit transaction log. profiles.credits is a cache of sum(amount) per user, written only by the functions in 015_functions.sql.';

create or replace function public.forbid_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'LEDGER_IMMUTABLE: credit_ledger rows cannot be updated or deleted; write a reversal row instead'
    using errcode = 'P0001';
end;
$$;

create trigger trg_credit_ledger_no_update
  before update on public.credit_ledger
  for each row execute function public.forbid_ledger_mutation();

create trigger trg_credit_ledger_no_delete
  before delete on public.credit_ledger
  for each row execute function public.forbid_ledger_mutation();
