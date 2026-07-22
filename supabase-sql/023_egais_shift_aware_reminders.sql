-- Напоминания ЕГАИС с учетом фактических смен в табеле.
-- Время в pg_cron указано в UTC, в комментариях — московское время.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  job record;
begin
  for job in
    select jobid
    from cron.job
    where jobname in (
      'alvisa-egais-departure-check',
      'alvisa-egais-validation-check',
      'alvisa-egais-validation-fallback'
    )
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;

-- 13:00 МСК: отправка суточных всем сотрудникам ЕГАИС со сменой в этот день.
select cron.schedule(
  'alvisa-egais-departure-check',
  '0 10 * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'alvisa_egais_reminder_project_url'
    ) || '/functions/v1/send-egais-file-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alvisa_egais_reminder_anon_key'
      ),
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alvisa_egais_reminder_anon_key'
      )
    ),
    body := '{"kind":"departure_check"}'::jsonb
  ) as request_id;
  $cron$
);

-- 00:15 МСК: проверка правильности для полной ночной смены 2/5 или 4/7.
select cron.schedule(
  'alvisa-egais-validation-check',
  '15 21 * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'alvisa_egais_reminder_project_url'
    ) || '/functions/v1/send-egais-file-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alvisa_egais_reminder_anon_key'
      ),
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alvisa_egais_reminder_anon_key'
      )
    ),
    body := '{"kind":"validation_check"}'::jsonb
  ) as request_id;
  $cron$
);

-- 08:30 МСК: запасной запуск для дневной смены, если полной ночной смены нет.
select cron.schedule(
  'alvisa-egais-validation-fallback',
  '30 5 * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'alvisa_egais_reminder_project_url'
    ) || '/functions/v1/send-egais-file-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alvisa_egais_reminder_anon_key'
      ),
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alvisa_egais_reminder_anon_key'
      )
    ),
    body := '{"kind":"validation_check"}'::jsonb
  ) as request_id;
  $cron$
);
