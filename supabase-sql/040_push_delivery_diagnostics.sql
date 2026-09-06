begin;

create or replace function public.create_my_push_test_notification()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_notification_id bigint;
begin
  if v_user_id is null then
    raise exception 'NO_SESSION';
  end if;

  insert into public.user_notifications (
    user_id,
    actor_user_id,
    type,
    title,
    body,
    url,
    expires_at
  ) values (
    v_user_id,
    v_user_id,
    'push_test',
    'Тестовое уведомление',
    'Push-уведомления ALVISA SALARY работают на этом устройстве.',
    'settings.html',
    now() + interval '10 minutes'
  ) returning id into v_notification_id;

  return v_notification_id;
end;
$$;

revoke all on function public.create_my_push_test_notification() from public, anon;
grant execute on function public.create_my_push_test_notification() to authenticated;

commit;
