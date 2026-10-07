-- New Auth sessions, not page views or token refreshes, create owner alerts.
begin;

create or replace function public.notify_owner_session_created()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  agent text := left(regexp_replace(coalesce(to_jsonb(new)->>'user_agent', ''), '[[:cntrl:]]', ' ', 'g'), 500);
  address text := left(coalesce(nullif(to_jsonb(new)->>'ip', ''), 'не определён'), 80);
  device text;
  browser_name text;
  message text;
begin
  if not exists (select 1 from public.profiles where user_id = new.user_id and role = 'owner') then
    return new;
  end if;
  device := case
    when agent ~* 'iphone|ipad' then 'iPhone / iPad'
    when agent ~* 'android' then 'Android'
    when agent ~* 'windows' then 'Windows'
    when agent ~* 'macintosh|mac os' then 'macOS'
    when agent ~* 'linux' then 'Linux'
    else 'устройство не определено' end;
  browser_name := case
    when agent ~* 'edg/' then 'Edge'
    when agent ~* 'firefox/|fxios/' then 'Firefox'
    when agent ~* 'opr/' then 'Opera'
    when agent ~* 'chrome/|crios/' then 'Chrome'
    when agent ~* 'safari/' then 'Safari'
    else 'браузер не определён' end;
  message := format('Новый вход: %s (Москва). Устройство: %s, %s. IP: %s. Если это не вы, смените пароль и завершите чужие сессии. IP может принадлежать VPN; точное местоположение не определяется.',
    to_char(now() at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI:SS'), device, browser_name, address);

  insert into public.owner_audit_log (actor_user_id, target_user_id, action, details)
  values (new.user_id, new.user_id, 'owner_login', jsonb_build_object(
    'device', device, 'browser', browser_name, 'ip', address, 'user_agent', agent));
  insert into public.user_notifications (user_id, actor_user_id, type, title, body, url, expires_at)
  values (new.user_id, new.user_id, 'owner_login', 'Вход в аккаунт владельца', message, 'owner.html', now() + interval '30 days');
  return new;
exception when others then
  -- An alert failure must not lock the owner out of Auth. No credentials in logs.
  raise warning 'OWNER_LOGIN_NOTIFICATION_FAILED [%]', sqlstate;
  return new;
end;
$$;
revoke all on function public.notify_owner_session_created() from public, anon, authenticated;
drop trigger if exists alvisa_owner_session_created on auth.sessions;
create trigger alvisa_owner_session_created after insert on auth.sessions
for each row execute function public.notify_owner_session_created();

commit;

-- Reuse existing Vault/cron configuration. In-app alerts work without cron.
do $$
declare job record;
begin
  if to_regclass('cron.job') is null or to_regclass('vault.decrypted_secrets') is null
    or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'OWNER_LOGIN_PUSH_NOT_CONFIGURED: pg_cron, pg_net and Vault are required';
    return;
  end if;
  if (select count(distinct name) from vault.decrypted_secrets
      where name in ('alvisa_egais_cron_secret', 'alvisa_egais_reminder_project_url', 'alvisa_egais_reminder_anon_key')
        and nullif(decrypted_secret, '') is not null) <> 3 then
    raise notice 'OWNER_LOGIN_PUSH_NOT_CONFIGURED: existing reminder Vault secrets are missing';
    return;
  end if;
  for job in select jobid from cron.job where jobname = 'alvisa-owner-login-push' loop
    perform cron.unschedule(job.jobid);
  end loop;
  perform cron.schedule('alvisa-owner-login-push', '* * * * *', $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_project_url' limit 1) || '/functions/v1/send-push-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key' limit 1),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key' limit 1),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_cron_secret' limit 1)
      ),
      body := '{"type":"owner_login","allUsers":true,"lookbackMinutes":60}'::jsonb
    ) where exists (
      select 1 from public.user_notifications
      where type = 'owner_login' and push_sent_at is null
        and expires_at > now() and created_at >= now() - interval '60 minutes'
    );
  $cron$);
end $$;
