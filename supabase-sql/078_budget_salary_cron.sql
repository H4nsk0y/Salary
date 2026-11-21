-- Deploy credit-budget-salary first. Uses the existing cron credentials.
begin;
do $$
declare v_job bigint; v_missing text;
begin
  select string_agg(required.name, ', ') into v_missing
  from (values ('alvisa_egais_cron_secret'), ('alvisa_egais_reminder_anon_key'),
    ('alvisa_egais_reminder_project_url')) required(name)
  where not exists (select 1 from vault.decrypted_secrets s where s.name = required.name and length(s.decrypted_secret) > 10);
  if v_missing is not null then raise exception 'Required Vault secrets are missing: %', v_missing; end if;
  for v_job in select jobid from cron.job where jobname = 'alvisa-budget-salary'
  loop perform cron.unschedule(v_job); end loop;
end $$;

-- Do not retroactively credit paydays that preceded enabling the feature.
update public.finance_budgets b
set state = jsonb_set(b.state, '{salaryAutoStart}', to_jsonb(to_char(timezone('Europe/Moscow', now()), 'YYYY-MM-DD'))),
    revision = b.revision + 1
where not (b.state ? 'salaryAutoStart')
  and exists (select 1 from public.profiles p where p.user_id = b.user_id and p.role = 'owner');

-- 07:00 UTC = 10:00 Moscow. Hourly retries recover network/CAS failures.
select cron.schedule('alvisa-budget-salary', '0 7-20 * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_project_url') || '/functions/v1/credit-budget-salary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_cron_secret')
    ), body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$cron$);
commit;
