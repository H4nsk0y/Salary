-- Owner-triggered notification about a published ALVISA SALARY update.
begin;

create or replace function public.owner_broadcast_product_update()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;
  if not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;

  insert into public.user_notifications (
    user_id,
    actor_user_id,
    type,
    title,
    body,
    url,
    expires_at
  )
  select distinct
    subscription.user_id,
    auth.uid(),
    'product_update',
    'Обновление ALVISA SALARY',
    'В ALVISA SALARY появились новые возможности. Откройте новости, чтобы узнать подробности.',
    'updates.html',
    now() + interval '14 days'
  from public.push_subscriptions subscription
  where subscription.enabled = true;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.owner_broadcast_product_update() from public, anon;
grant execute on function public.owner_broadcast_product_update() to authenticated;

commit;
