-- Remove the client notification INSERT policy. Notifications are created by trusted server-side triggers.
drop policy if exists notifications_insert_own on public.notifications;
