-- Notify only the employees who actually take over after a completed checklist.
-- Run this script in Supabase SQL Editor, then redeploy send-push-notifications.

begin;

create or replace function public.shift_hours_on_date(
  p_user_id uuid,
  p_shift_date date
)
returns table (
  day_hours numeric,
  night_hours numeric,
  leave_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when (timesheet.payload -> 'dayHours' ->> (extract(day from p_shift_date)::integer - 1))
        ~ '^[0-9]+([.][0-9]+)?$'
      then (timesheet.payload -> 'dayHours' ->> (extract(day from p_shift_date)::integer - 1))::numeric
      else 0
    end as day_hours,
    case
      when (timesheet.payload -> 'nightHours' ->> (extract(day from p_shift_date)::integer - 1))
        ~ '^[0-9]+([.][0-9]+)?$'
      then (timesheet.payload -> 'nightHours' ->> (extract(day from p_shift_date)::integer - 1))::numeric
      else 0
    end as night_hours,
    nullif(btrim(timesheet.payload -> 'leaveType' ->> (extract(day from p_shift_date)::integer - 1)), '') as leave_code
  from public.timesheets timesheet
  where timesheet.user_id = p_user_id
    and timesheet.year = extract(year from p_shift_date)::integer
    and timesheet.month = extract(month from p_shift_date)::integer - 1
  limit 1;
$$;

create or replace function public.is_shift_handover_manager_position(p_position text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    lower(btrim(coalesce(p_position, ''))) in (
      'egais_head',
      'warehouse_head',
      'bottling_plant_head',
      'laboratory_head',
      'deputy_head_laboratory',
      'chief_accountant',
      'deputy_chief_accountant',
      'hr_service_head',
      'director'
    )
    or lower(btrim(coalesce(p_position, ''))) ~
      '(руководител|начальник|директор|главн(ый|ая)[[:space:]]+бухгалтер|заместител.*(руковод|началь|директор|бухгалтер))';
$$;

create or replace function public.is_night_shift_start(
  p_day_hours numeric,
  p_night_hours numeric
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    coalesce(p_night_hours, 0) > 0
    and not (
      coalesce(p_night_hours, 0) = 5
      and coalesce(p_day_hours, 0) in (1, 2)
    );
$$;

create or replace function public.finish_my_shift_checklist(p_checklist_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.shift_checklists%rowtype;
  v_total integer;
  v_completed integer;
  v_percent integer;
  v_moscow_now timestamp without time zone := clock_timestamp() at time zone 'Europe/Moscow';
  v_schedule_date date;
  v_target_date date;
  v_outgoing_day numeric := 0;
  v_outgoing_night numeric := 0;
  v_previous_night numeric := 0;
  v_handover_kind text;
  v_recipient_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'NO_SESSION';
  end if;

  select * into v_row
  from public.shift_checklists
  where id = p_checklist_id
    and user_id = v_user_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'CHECKLIST_NOT_FOUND';
  end if;

  select
    count(*)::integer,
    count(*) filter (where (entry.value ->> 'done')::boolean)::integer
  into v_total, v_completed
  from jsonb_array_elements(v_row.items) as entry(value);

  v_percent := case when v_total > 0 then round(v_completed * 100.0 / v_total)::integer else 0 end;

  update public.shift_checklists
  set
    status = 'completed',
    completed_at = now(),
    completed_count = v_completed,
    total_count = v_total,
    completion_percent = v_percent,
    reminders_enabled = false,
    next_reminder_at = null
  where id = p_checklist_id
  returning * into v_row;

  -- A stale checklist must never notify whoever happens to work today.
  if v_row.department_key is not null
    and v_row.started_at >= now() - interval '36 hours' then
    v_schedule_date := v_moscow_now::date;

    select hours.day_hours, hours.night_hours
    into v_outgoing_day, v_outgoing_night
    from public.shift_hours_on_date(v_user_id, v_schedule_date) hours;

    v_outgoing_day := coalesce(v_outgoing_day, 0);
    v_outgoing_night := coalesce(v_outgoing_night, 0);

    if extract(hour from v_moscow_now) < 12 and v_outgoing_night = 0 then
      -- Evening shifts such as 6/2 end just after midnight and live on yesterday's row.
      select hours.night_hours
      into v_previous_night
      from public.shift_hours_on_date(v_user_id, v_schedule_date - 1) hours;

      v_previous_night := coalesce(v_previous_night, 0);
    end if;

    if extract(hour from v_moscow_now) < 12
      and (v_outgoing_night > 0 or v_previous_night > 0) then
      -- A night worker finishes in the morning of the second calendar date.
      v_handover_kind := 'night_to_day';
      v_target_date := v_schedule_date;
    elsif v_outgoing_day > 0 and v_outgoing_night = 0 then
      -- A day worker hands over to employees who have night hours on this date.
      v_handover_kind := 'day_to_night';
      v_target_date := v_schedule_date;
    end if;

    if v_handover_kind is not null then
      insert into public.user_notifications (
        user_id,
        actor_user_id,
        department_key,
        type,
        title,
        body,
        url,
        expires_at
      )
      select
        member.user_id,
        v_user_id,
        v_row.department_key,
        'shift_handover_ready',
        'Смена передана',
        'Ваш коллега сдал смену. Перед началом работы откройте и заполните свой чек-лист.',
        'checklist.html',
        now() + interval '2 days'
      from public.department_members member
      left join public.profiles profile on profile.user_id = member.user_id
      cross join lateral public.shift_hours_on_date(member.user_id, v_target_date) hours
      where member.department_key = v_row.department_key
        and member.user_id <> v_user_id
        and not public.is_shift_handover_manager_position(profile.position)
        and hours.leave_code is null
        and (
          (v_handover_kind = 'day_to_night' and public.is_night_shift_start(hours.day_hours, hours.night_hours))
          or
          (v_handover_kind = 'night_to_day' and hours.day_hours > 0 and hours.night_hours = 0)
        )
        and not exists (
          select 1
          from public.user_notifications existing
          where existing.user_id = member.user_id
            and existing.actor_user_id = v_user_id
            and existing.department_key = v_row.department_key
            and existing.type = 'shift_handover_ready'
            and existing.created_at >= now() - interval '10 hours'
        );

      get diagnostics v_recipient_count = row_count;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'department_key', v_row.department_key,
    'items', v_row.items,
    'started_at', v_row.started_at,
    'completed_at', v_row.completed_at,
    'completed_count', v_row.completed_count,
    'total_count', v_row.total_count,
    'completion_percent', v_row.completion_percent,
    'handover_recipients', v_recipient_count
  );
end;
$$;

-- An ordinary employee may launch push delivery only for handover notifications
-- that were just created by the protected completion RPC on their behalf.
create or replace function public.can_send_shift_handover_push(p_department_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.user_notifications notification
    where notification.actor_user_id = auth.uid()
      and notification.department_key = nullif(btrim(p_department_key), '')
      and notification.type = 'shift_handover_ready'
      and notification.push_sent_at is null
      and notification.created_at >= now() - interval '10 minutes'
      and notification.expires_at > now()
  );
$$;

revoke all on function public.shift_hours_on_date(uuid, date) from public, anon, authenticated;
revoke all on function public.is_shift_handover_manager_position(text) from public, anon, authenticated;
revoke all on function public.is_night_shift_start(numeric, numeric) from public, anon, authenticated;
revoke all on function public.finish_my_shift_checklist(bigint) from public, anon;
revoke all on function public.can_send_shift_handover_push(text) from public, anon;

grant execute on function public.finish_my_shift_checklist(bigint) to authenticated;
grant execute on function public.can_send_shift_handover_push(text) to authenticated;

commit;
