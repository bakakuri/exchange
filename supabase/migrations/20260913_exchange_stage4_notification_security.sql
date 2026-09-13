-- Security fix: authenticated users may read and mark their own notifications,
-- but cannot create notification rows themselves. Server-side triggers remain able to write them.
alter policy notifications_insert_own on public.notifications
  using (false)
  with check (false);
