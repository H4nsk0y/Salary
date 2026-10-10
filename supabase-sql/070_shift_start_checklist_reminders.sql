-- Deploy send-shift-reminders before running this file.
-- Existing 17:00 upcoming-shift reminders remain unchanged.
begin;

do $$
declare
  v_job_id bigint;
  v_missing text;
begin
  select string_agg(required.name, ', ' order by required.name)
  into v_missing
  from (values
    ('alvisa_egais_cron_secret', 32),
    ('alvisa_egais_reminder_anon_key', 20),
    ('alvisa_egais_reminder_project_url', 12)
  ) as required(name, min_length)
  where not exists (
    select 1 from vault.decrypted_secrets secret
    where secret.name = required.name
      and char_length(secret.decrypted_secret) >= required.min_length
  );
  if v_missing is not null then
    raise exception 'Required Vault secrets are missing: %', v_missing;
  end if;

  for v_job_id in
    select jobid from cron.job where jobname = 'alvisa-shift-start-checklists'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

-- Moscow is UTC+3: 05:05 and 17:05 UTC are 08:05 and 20:05 local.
select cron.schedule(
  'alvisa-shift-start-checklists',
  '5 5,17 * * *',
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
  );
  $cron$
);

commit;
