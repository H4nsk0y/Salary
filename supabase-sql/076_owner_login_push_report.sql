-- Read-only diagnostic. Run in Supabase SQL Editor after 075 and a fresh owner login.
-- No secret values, IP addresses, user identifiers, endpoints or HTTP bodies are returned.
select
  exists (select 1 from cron.job where jobname = 'alvisa-owner-login-push' and active) as retry_job_active,
  (select count(distinct name) = 3 from vault.decrypted_secrets where name in (
    'alvisa_egais_reminder_project_url', 'alvisa_egais_reminder_anon_key', 'alvisa_egais_cron_secret'
  ) and nullif(decrypted_secret, '') is not null) as vault_configured,
  (select count(*) from public.push_subscriptions s
    join public.profiles p on p.user_id = s.user_id and p.role = 'owner'
    where s.enabled) as active_owner_devices,
  d.queued_at as last_request_queued_at,
  r.status_code as last_http_status,
  r.timed_out as last_http_timeout
from (values (true)) as singleton(key)
left join public.owner_login_push_dispatch_state d on d.singleton = singleton.key
left join net._http_response r on r.id = d.request_id;

select created_at, push_sent_at, owner_login_push_claimed_at,
  case when push_error is not null then 'Ошибка доставки или нет активной подписки' end as delivery_error
from public.user_notifications
where type = 'owner_login'
order by created_at desc, id desc
limit 5;
