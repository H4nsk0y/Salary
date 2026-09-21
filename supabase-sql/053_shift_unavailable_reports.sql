-- Let an employee report that they cannot attend one of their own scheduled shifts.

begin;

create or replace function public.report_my_shift_unavailable(
  p_year integer,
  p_month integer,
  p_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_department_key text;
  v_payload jsonb;
  v_day_index integer;
  v_days integer;
  v_day_hours numeric := 0;
  v_night_hours numeric := 0;
  v_leave text;
  v_comments jsonb := '[]'::jsonb;
  v_existing_comment text;
  v_report_comment constant text := 'Комментарий от сотрудника: Не смогу выйти';
  v_next_comment text;
  v_before jsonb;
  v_after jsonb;
  v_employee_name text;
  v_recipient_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'NO_SESSION';
  end if;
  if p_year < 2000 or p_year > 2100 or p_month < 0 or p_month > 11 then
    raise exception 'INVALID_TIMESHEET_PERIOD';
  end if;

  v_days := extract(day from (make_date(p_year, p_month + 1, 1) + interval '1 month - 1 day'))::integer;
  if p_day < 1 or p_day > v_days then
    raise exception 'INVALID_SHIFT_DAY';
  end if;
  v_day_index := p_day - 1;

  select member.department_key
  into v_department_key
  from public.department_members member
  where member.user_id = v_user_id
  order by member.created_at
  limit 1;

  if v_department_key is null then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  select timesheet.payload
  into v_payload
  from public.timesheets timesheet
  where timesheet.user_id = v_user_id
    and timesheet.year = p_year
    and timesheet.month = p_month
  for update;

  if not found then
    raise exception 'TIMESHEET_NOT_FOUND';
  end if;

  v_leave := nullif(btrim(v_payload -> 'leaveType' ->> v_day_index), '');
  if coalesce(v_payload -> 'dayHours' ->> v_day_index, '') ~ '^[0-9]+([.][0-9]+)?$' then
    v_day_hours := (v_payload -> 'dayHours' ->> v_day_index)::numeric;
  end if;
  if coalesce(v_payload -> 'nightHours' ->> v_day_index, '') ~ '^[0-9]+([.][0-9]+)?$' then
    v_night_hours := (v_payload -> 'nightHours' ->> v_day_index)::numeric;
  end if;

  if v_leave is not null
     or not (
       v_day_hours >= 6
       or (
         v_night_hours > 0
         and not (v_night_hours = 5 and v_day_hours in (1, 2))
       )
     ) then
    raise exception 'SHIFT_NOT_SCHEDULED';
  end if;

  v_existing_comment := btrim(coalesce(v_payload -> 'shiftComments' ->> v_day_index, ''));
  if position(lower(v_report_comment) in lower(v_existing_comment)) > 0 then
    return jsonb_build_object(
      'department_key', v_department_key,
      'comment', v_existing_comment,
      'already_reported', true,
      'recipients', 0
    );
  end if;

  for v_day_index in 0..v_days - 1 loop
    v_comments := v_comments || jsonb_build_array(
      coalesce(v_payload -> 'shiftComments' ->> v_day_index, '')
    );
  end loop;
  v_day_index := p_day - 1;

  v_next_comment := case
    when v_existing_comment = '' then v_report_comment
    else left(v_existing_comment, 430) || E'\n' || v_report_comment
  end;

  v_before := public._timesheet_employee_day_state(v_payload, v_day_index);
  v_comments := jsonb_set(v_comments, array[v_day_index::text], to_jsonb(v_next_comment), false);
  v_payload := jsonb_set(v_payload, '{shiftComments}', v_comments, true);
  v_after := public._timesheet_employee_day_state(v_payload, v_day_index);

  update public.timesheets
  set payload = v_payload
  where user_id = v_user_id
    and year = p_year
    and month = p_month;

  select coalesce(nullif(btrim(profile.display_name), ''), 'Сотрудник')
  into v_employee_name
  from public.profiles profile
  where profile.user_id = v_user_id;

  insert into public.department_timesheet_audit_log (
    actor_user_id,
    department_key,
    year,
    month,
    employee_changes,
    calendar_changes
  ) values (
    v_user_id,
    v_department_key,
    p_year,
    p_month,
    jsonb_build_array(jsonb_build_object(
      'user_id', v_user_id,
      'name', coalesce(v_employee_name, 'Сотрудник'),
      'days', jsonb_build_array(jsonb_build_object(
        'day', p_day,
        'before', v_before,
        'after', v_after
      ))
    )),
    '[]'::jsonb
  );

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
    editor.user_id,
    v_user_id,
    v_department_key,
    'shift_unavailable',
    'Сотрудник не сможет выйти',
    coalesce(v_employee_name, 'Сотрудник') || ' сообщил(а), что не сможет выйти ' ||
      lpad(p_day::text, 2, '0') || '.' || lpad((p_month + 1)::text, 2, '0') || '.' || p_year::text || '.',
    'admin.html?department=' || v_department_key || '&year=' || p_year::text ||
      '&month=' || p_month::text || '&employee=' || v_user_id::text,
    now() + interval '14 days'
  from public.department_editors editor
  where editor.department_key = v_department_key
    and editor.user_id <> v_user_id;

  get diagnostics v_recipient_count = row_count;

  return jsonb_build_object(
    'department_key', v_department_key,
    'comment', v_next_comment,
    'already_reported', false,
    'recipients', v_recipient_count
  );
end;
$$;

create or replace function public.can_send_shift_unavailable_push(p_department_key text)
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
      and notification.type = 'shift_unavailable'
      and notification.push_sent_at is null
      and notification.created_at >= now() - interval '10 minutes'
      and notification.expires_at > now()
  );
$$;

revoke all on function public.report_my_shift_unavailable(integer, integer, integer)
from public, anon;
revoke all on function public.can_send_shift_unavailable_push(text)
from public, anon;
grant execute on function public.report_my_shift_unavailable(integer, integer, integer)
to authenticated;
grant execute on function public.can_send_shift_unavailable_push(text)
to authenticated;

commit;
