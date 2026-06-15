alter table public.user_notifications
add column if not exists push_sent_at timestamptz,
add column if not exists push_error text;

comment on column public.user_notifications.push_sent_at is 'Когда по этому уведомлению была выполнена попытка отправить Web Push.';
comment on column public.user_notifications.push_error is 'Краткая ошибка последней Web Push отправки, если она была.';

create index if not exists user_notifications_push_pending_idx
on public.user_notifications (department_key, type, created_at desc)
where push_sent_at is null;
