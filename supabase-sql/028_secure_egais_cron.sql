-- Secure the scheduled EGAIS Edge Function with a separate shared secret.
-- Before running:
-- 1. Create a long random value locally.
-- 2. Save it as Edge secret: supabase secrets set CRON_SECRET="..."
-- 3. Save the same value in Vault as `alvisa_egais_cron_secret`.
-- Never place the real value in this repository.

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'alvisa_egais_cron_secret'
      and char_length(decrypted_secret) >= 32
  ) then
    raise exception 'Create Vault secret alvisa_egais_cron_secret (at least 32 characters) first';
  end if;
end $$;

do $$
declare
  job record;
begin
  for job in
    select jobid from cron.job
    where jobname in (
      'alvisa-egais-departure-check',
      'alvisa-egais-validation-check',
      'alvisa-egais-validation-fallback'
    )
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;

select cron.schedule(
  'alvisa-egais-departure-check',
  '0 10 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_project_url') || '/functions/v1/send-egais-file-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_cron_secret')
    ),
    body := '{"kind":"departure_check"}'::jsonb
  ) as request_id;
  $cron$
);

select cron.schedule(
  'alvisa-egais-validation-check',
  '15 21 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_project_url') || '/functions/v1/send-egais-file-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_cron_secret')
    ),
    body := '{"kind":"validation_check"}'::jsonb
  ) as request_id;
  $cron$
);

select cron.schedule(
  'alvisa-egais-validation-fallback',
  '30 5 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_project_url') || '/functions/v1/send-egais-file-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_cron_secret')
    ),
    body := '{"kind":"validation_check"}'::jsonb
  ) as request_id;
  $cron$
);
