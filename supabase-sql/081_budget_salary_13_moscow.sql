-- Deploy credit-budget-salary first so browser and server both credit at 13:00 Moscow.
-- Preserve the existing command, credentials and budget data.
begin;
do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'alvisa-budget-salary';
  if v_job is null then
    raise exception 'Apply 078_budget_salary_cron.sql first';
  end if;
  perform cron.alter_job(v_job, schedule := '0 10-20 * * *');
end $$;
commit;
