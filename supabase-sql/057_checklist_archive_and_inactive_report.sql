-- Two-month personal checklist archive and a monthly inactive-user report for owners.
begin;

create or replace function public.get_my_shift_checklist_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'active', (
      select jsonb_build_object(
        'id', checklist.id,
        'department_key', checklist.department_key,
        'department_name', checklist.department_name,
        'items', checklist.items,
        'reminders_enabled', checklist.reminders_enabled,
        'started_at', checklist.started_at,
        'next_reminder_at', checklist.next_reminder_at,
        'updated_at', checklist.updated_at
      )
      from public.shift_checklists checklist
      where checklist.user_id = auth.uid()
        and checklist.status = 'active'
      order by checklist.started_at desc
      limit 1
    ),
    'latest_completed', (
      select jsonb_build_object(
        'id', checklist.id,
        'department_key', checklist.department_key,
        'department_name', checklist.department_name,
        'items', checklist.items,
        'started_at', checklist.started_at,
        'completed_at', checklist.completed_at,
        'completed_count', checklist.completed_count,
        'total_count', checklist.total_count,
        'completion_percent', checklist.completion_percent
      )
      from public.shift_checklists checklist
      where checklist.user_id = auth.uid()
        and checklist.status = 'completed'
        and checklist.completed_at >= now() - interval '2 months'
      order by checklist.completed_at desc
      limit 1
    )
  )
  where auth.uid() is not null;
$$;

revoke all on function public.get_my_shift_checklist_state() from public, anon;
grant execute on function public.get_my_shift_checklist_state() to authenticated;

create or replace function public.get_my_shift_checklist_history()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', history.id,
    'items', history.items,
    'started_at', history.started_at,
    'completed_at', history.completed_at,
    'completed_count', history.completed_count,
    'total_count', history.total_count,
    'completion_percent', history.completion_percent
  ) order by history.completed_at desc), '[]'::jsonb)
  from public.shift_checklists history
  where history.user_id = auth.uid()
    and history.status = 'completed'
    and history.completed_at >= now() - interval '2 months'
    and auth.uid() is not null;
$$;

revoke all on function public.get_my_shift_checklist_history() from public, anon;
grant execute on function public.get_my_shift_checklist_history() to authenticated;

create or replace function public.cleanup_old_shift_checklists()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.shift_checklists checklist
  where checklist.status = 'completed'
    and checklist.completed_at < now() - interval '2 months';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_old_shift_checklists() from public, anon, authenticated;

create or replace function public.create_monthly_inactive_users_report()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_names text;
begin
  select count(*)::integer,
         string_agg(
           coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.position), ''), 'Пользователь ' || left(profile.user_id::text, 8)),
           '; ' order by coalesce(presence.last_seen, profile.created_at), profile.display_name
         )
  into v_count, v_names
  from public.profiles profile
  left join public.user_presence presence on presence.user_id = profile.user_id
  where coalesce(profile.role, 'user') <> 'owner'
    and coalesce(presence.last_seen, profile.created_at) < now() - interval '2 months';

  insert into public.user_notifications (
    user_id, type, title, body, url, expires_at
  )
  select
    owner_profile.user_id,
    'owner_inactive_users_report',
    'Неактивные пользователи: ' || v_count,
    case
      when v_count = 0 then 'Пользователей без активности более двух месяцев нет.'
      else 'Более двух месяцев не заходили: ' || v_names
    end,
    'owner-users.html',
    now() + interval '35 days'
  from public.profiles owner_profile
  where owner_profile.role = 'owner'
    and not exists (
      select 1
      from public.user_notifications existing
      where existing.user_id = owner_profile.user_id
        and existing.type = 'owner_inactive_users_report'
        and date_trunc('month', existing.created_at at time zone 'Europe/Moscow') =
            date_trunc('month', now() at time zone 'Europe/Moscow')
    );

  return v_count;
end;
$$;

revoke all on function public.create_monthly_inactive_users_report() from public, anon, authenticated;

commit;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname in ('alvisa-checklist-retention', 'alvisa-inactive-users-report')
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

-- Retention does not depend on a browser visit.
select cron.schedule(
  'alvisa-checklist-retention',
  '30 0 * * *',
  $$select public.cleanup_old_shift_checklists();$$
);

-- 00:15 UTC is 03:15 Moscow. The SQL function prevents duplicate monthly reports.
select cron.schedule(
  'alvisa-inactive-users-report',
  '15 0 1 * *',
  $cron$
  select public.cleanup_old_shift_checklists();
  select public.create_monthly_inactive_users_report();
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_project_url') || '/functions/v1/send-push-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_cron_secret')
    ),
    body := '{"type":"owner_inactive_users_report","allUsers":true,"lookbackMinutes":30}'::jsonb
  ) as request_id;
  $cron$
);
