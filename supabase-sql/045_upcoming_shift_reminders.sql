begin;

-- Push tests are now created by send-push-notifications itself. Keep the old RPC
-- available for clients that have not refreshed yet.
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
    user_id, actor_user_id, type, title, body, url, expires_at
  ) values (
    v_user_id, v_user_id, 'push_test', 'Тестовое уведомление',
    'Push-уведомления ALVISA SALARY работают на этом устройстве.',
    'settings.html', now() + interval '10 minutes'
  ) returning id into v_notification_id;

  return v_notification_id;
end;
$$;

revoke all on function public.create_my_push_test_notification() from public, anon;
grant execute on function public.create_my_push_test_notification() to authenticated;

commit;

do $$
declare
  v_missing text;
begin
  select string_agg(required.name, ', ' order by required.name)
  into v_missing
  from (
    values
      ('alvisa_egais_cron_secret', 32),
      ('alvisa_egais_reminder_anon_key', 20),
      ('alvisa_egais_reminder_project_url', 12)
  ) as required(name, min_length)
  where not exists (
    select 1
    from vault.decrypted_secrets secret
    where secret.name = required.name
      and char_length(secret.decrypted_secret) >= required.min_length
  );

  if v_missing is not null then
    raise exception 'Required Vault secrets are missing: %', v_missing;
  end if;
end $$;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'alvisa-upcoming-shift-reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

-- 14:00 UTC is 17:00 in Moscow throughout the year.
select cron.schedule(
  'alvisa-upcoming-shift-reminders',
  '0 14 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_project_url') || '/functions/v1/send-shift-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $cron$
);

