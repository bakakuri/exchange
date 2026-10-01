-- 006_task_verifications.sql
-- The proof a user submits for a completion attempt. 1:1 with
-- task_completions; the completion row carries the authoritative status
-- (pending/approved/rejected/expired) so there is exactly one place that
-- state can drift - never here.

create table public.task_verifications (
  id uuid primary key default gen_random_uuid(),
  completion_id uuid not null unique references public.task_completions(id) on delete cascade,
  proof_url text,
  proof_text text,
  submitted_at timestamptz not null default now(),
  review_notes text,
  constraint proof_provided check (proof_url is not null or proof_text is not null)
);

comment on table public.task_verifications is 'Proof of completion. The review decision itself lives on the parent task_completions row.';
