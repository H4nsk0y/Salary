-- Only technical execution history: never business data, checklist or security logs.
begin;

delete from cron.job_run_details
where (status = 'succeeded' and end_time < now() - interval '7 days')
   or (status = 'failed' and end_time < now() - interval '30 days');

select cron.schedule('alvisa-cron-history-retention', '40 1 * * *', $cleanup$
  delete from cron.job_run_details
  where (status = 'succeeded' and end_time < now() - interval '7 days')
     or (status = 'failed' and end_time < now() - interval '30 days');
$cleanup$);

commit;

-- Optional one-time space reclamation after applying this file, separately,
-- outside a transaction and off peak (brief exclusive locks on technical tables):
-- vacuum (full, analyze) cron.job_run_details;
-- vacuum (full, analyze) net._http_response;
