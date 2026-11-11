-- Apply after 067. Auth still creates the in-app alert even if push is unavailable.
begin;

alter table public.user_notifications add column if not exists owner_login_push_claimed_at timestamptz;

create table if not exists public.owner_login_push_dispatch_state (
  singleton boolean primary key check (singleton),
  request_id bigint not null,
  queued_at timestamptz not null
);
alter table public.owner_login_push_dispatch_state enable row level security;
revoke all on public.owner_login_push_dispatch_state from public, anon, authenticated;

create or replace function public.claim_owner_login_push(
  p_user_id uuid, p_lookback_minutes integer, p_limit integer
)
returns table (id bigint, user_id uuid, title text, body text, url text)
language sql volatile security definer set search_path = public, pg_temp as $$
  with pending as (
    select n.id from public.user_notifications n
    join public.profiles p on p.user_id = n.user_id and p.role = 'owner'
    where n.type = 'owner_login' and n.push_sent_at is null and n.expires_at > now()
      and n.created_at >= now() - make_interval(mins => greatest(1, least(60, coalesce(p_lookback_minutes, 60))))
      and (n.owner_login_push_claimed_at is null or n.owner_login_push_claimed_at < now() - interval '3 minutes')
      and (p_user_id is null or n.user_id = p_user_id)
    order by n.created_at, n.id
    limit greatest(1, least(20, coalesce(p_limit, 10)))
    for update of n skip locked
  )
  update public.user_notifications n set owner_login_push_claimed_at = now()
  from pending where pending.id = n.id
  returning n.id, n.user_id, n.title, n.body, n.url;
$$;
revoke all on function public.claim_owner_login_push(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_owner_login_push(uuid, integer, integer) to service_role;

create or replace function public._queue_owner_login_push()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  project_url text;
  anon_key text;
  cron_secret text;
  queued_id bigint;
begin
  if to_regclass('vault.decrypted_secrets') is null
    or not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;

  if not exists (select 1 from public.user_notifications n
    join public.profiles p on p.user_id = n.user_id and p.role = 'owner'
    where n.type = 'owner_login' and n.push_sent_at is null and n.expires_at > now()
      and n.created_at >= now() - interval '60 minutes'
      and (n.owner_login_push_claimed_at is null or n.owner_login_push_claimed_at < now() - interval '3 minutes')) then return; end if;

  select nullif(decrypted_secret, '') into project_url
    from vault.decrypted_secrets where name = 'alvisa_egais_reminder_project_url' limit 1;
  select nullif(decrypted_secret, '') into anon_key
    from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key' limit 1;
  select nullif(decrypted_secret, '') into cron_secret
    from vault.decrypted_secrets where name = 'alvisa_egais_cron_secret' limit 1;
  if project_url is null or anon_key is null or cron_secret is null then return; end if;

  queued_id := net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/send-push-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', anon_key,
      'Authorization', 'Bearer ' || anon_key, 'x-cron-secret', cron_secret),
    body := '{"type":"owner_login","allUsers":true,"lookbackMinutes":60,"limit":10}'::jsonb,
    timeout_milliseconds := 15000
  );
  insert into public.owner_login_push_dispatch_state (singleton, request_id, queued_at)
    values (true, queued_id, now())
  on conflict (singleton) do update
    set request_id = excluded.request_id, queued_at = excluded.queued_at;
end;
$$;

create or replace function public._dispatch_new_owner_login_push()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._queue_owner_login_push();
  return new;
exception when others then
  -- Leave the in-app alert intact and let the retry job pick it up.
  raise warning 'OWNER_LOGIN_PUSH_QUEUE_FAILED [%]', sqlstate;
  return new;
end;
$$;
revoke all on function public._queue_owner_login_push(), public._dispatch_new_owner_login_push()
  from public, anon, authenticated;

drop trigger if exists alvisa_dispatch_new_owner_login_push on public.user_notifications;
create trigger alvisa_dispatch_new_owner_login_push after insert on public.user_notifications
for each row when (new.type = 'owner_login') execute function public._dispatch_new_owner_login_push();

do $$
declare job record;
begin
  if to_regclass('cron.job') is null then
    raise notice 'OWNER_LOGIN_PUSH_RETRY_NOT_CONFIGURED: pg_cron is required';
    return;
  end if;
  for job in select jobid from cron.job where jobname = 'alvisa-owner-login-push' loop
    perform cron.unschedule(job.jobid);
  end loop;
  perform cron.schedule('alvisa-owner-login-push', '* * * * *', 'select public._queue_owner_login_push();');
end;
$$;

notify pgrst, 'reload schema';
commit;
