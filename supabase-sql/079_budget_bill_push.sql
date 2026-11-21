-- Deploy send-budget-reminders before enabling this schedule. Apply after 078.
begin;
create table if not exists public.budget_bill_push_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_day date not null,
  claimed_at timestamptz,
  delivered_at timestamptz,
  notification_id bigint references public.user_notifications(id) on delete set null,
  primary key (user_id, reminder_day)
);
alter table public.budget_bill_push_days enable row level security;
revoke all on public.budget_bill_push_days from public, anon, authenticated;
grant select, insert, update, delete on public.budget_bill_push_days to service_role;

create or replace function public.claim_budget_bill_reminder(p_user_id uuid)
returns table (notification_id bigint, reminder_day date)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_day date := timezone('Europe/Moscow', now())::date; v_id bigint;
begin
  if not exists (select 1 from public.profiles p where p.user_id=p_user_id and p.role='owner') then return; end if;
  delete from public.budget_bill_push_days d where d.reminder_day < v_day - 35;
  insert into public.budget_bill_push_days(user_id,reminder_day) values(p_user_id,v_day) on conflict do nothing;
  update public.budget_bill_push_days d set claimed_at=now()
    where d.user_id=p_user_id and d.reminder_day=v_day and d.delivered_at is null
      and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
    returning d.notification_id into v_id;
  if not found then return; end if;
  if v_id is null then
    insert into public.user_notifications(user_id,type,title,body,url,expires_at)
      values(p_user_id,'budget_bill_reminder','Ближайшие обязательные платежи',
        'Приближается срок обязательных платежей. Откройте «Мой бюджет», чтобы проверить список.',
        'budget.html',now()+interval '36 hours') returning id into v_id;
    update public.budget_bill_push_days d set notification_id=v_id where d.user_id=p_user_id and d.reminder_day=v_day;
  end if;
  return query select v_id,v_day;
end;
$$;
revoke all on function public.claim_budget_bill_reminder(uuid) from public, anon, authenticated;
grant execute on function public.claim_budget_bill_reminder(uuid) to service_role;

do $$
declare v_job bigint; v_missing text;
begin
  select string_agg(required.name,', ') into v_missing from (values
    ('alvisa_egais_cron_secret'),('alvisa_egais_reminder_anon_key'),('alvisa_egais_reminder_project_url')) required(name)
  where not exists (select 1 from vault.decrypted_secrets s where s.name=required.name and length(s.decrypted_secret)>10);
  if v_missing is not null then raise exception 'Required Vault secrets are missing: %', v_missing; end if;
  for v_job in select jobid from cron.job where jobname='alvisa-budget-bill-reminders' loop perform cron.unschedule(v_job); end loop;
end $$;
-- First check at 10:00 Moscow, then hourly retries; at most one delivered reminder per day.
select cron.schedule('alvisa-budget-bill-reminders','0 7-20 * * *',$cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='alvisa_egais_reminder_project_url') || '/functions/v1/send-budget-reminders',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='alvisa_egais_reminder_anon_key'),
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='alvisa_egais_reminder_anon_key'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='alvisa_egais_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$cron$);
commit;
