-- Exchange Stage 2 UX: notifications infrastructure
-- Run AFTER 20260913_exchange_security_economy.sql

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'system',
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications(user_id, read_at)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notifications_insert_own on public.notifications;
create policy notifications_insert_own
  on public.notifications for insert
  to authenticated
  with check (user_id = auth.uid());

create or replace function public.notify_credit_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body text;
begin
  if new.amount is null or new.amount = 0 then
    return new;
  end if;

  v_title := case new.type
    when 'task_reward' then 'დავალების ჯილდო'
    when 'promotion_spend' then 'კამპანიის გადახდა'
    when 'promotion_refund' then 'კამპანიის თანხა დაბრუნდა'
    when 'opening_balance' then 'საწყისი ბალანსის კორექცია'
    when 'admin_adjustment' then 'ადმინისტრატორის კორექცია'
    else 'კრედიტების ცვლილება'
  end;

  v_body := case
    when new.amount > 0 then '+' || new.amount::text || ' კრედიტი'
    else new.amount::text || ' კრედიტი'
  end;

  insert into public.notifications(user_id,type,title,body)
  values (new.user_id,'credit',v_title,v_body);

  return new;
end;
$$;

drop trigger if exists credit_transaction_notification on public.credit_transactions;
create trigger credit_transaction_notification
after insert on public.credit_transactions
for each row execute function public.notify_credit_transaction();

create or replace function public.notify_promotion_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.notifications(user_id,type,title,body)
    values (
      new.user_id,
      'promotion',
      'კამპანიის სტატუსი შეიცვალა',
      coalesce(new.title,'კამპანია') || ': ' || coalesce(new.status,'unknown')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists promotion_status_notification on public.promotions;
create trigger promotion_status_notification
after update of status on public.promotions
for each row execute function public.notify_promotion_status();

-- Enable Supabase Realtime without failing if the table is already published.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end;
$$;

revoke all on function public.notify_credit_transaction() from public, anon, authenticated;
revoke all on function public.notify_promotion_status() from public, anon, authenticated;
