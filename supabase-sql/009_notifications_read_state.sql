alter table public.user_notifications
add column if not exists read_at timestamptz;

comment on column public.user_notifications.read_at is 'Когда пользователь впервые открыл и закрыл уведомление. NULL = непрочитано.';

create index if not exists user_notifications_user_unread_idx
on public.user_notifications (user_id, created_at desc)
where read_at is null;

create or replace function public.mark_my_notifications_read(
  p_notification_ids bigint[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  update public.user_notifications
  set read_at = coalesce(read_at, now())
  where user_id = auth.uid()
    and expires_at > now()
    and read_at is null
    and (
      p_notification_ids is null
      or id = any(p_notification_ids)
    );
end;
$$;

revoke all on function public.mark_my_notifications_read(bigint[]) from public;
grant execute on function public.mark_my_notifications_read(bigint[]) to authenticated;
