begin;

create table if not exists public.department_timesheet_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  department_key text not null references public.departments(key) on update cascade on delete restrict,
  year integer not null,
  month integer not null,
  employee_changes jsonb not null default '[]'::jsonb,
  calendar_changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint department_timesheet_audit_period_check
    check (year between 2000 and 2100 and month between 0 and 11),
  constraint department_timesheet_audit_employee_changes_check
    check (jsonb_typeof(employee_changes) = 'array'),
  constraint department_timesheet_audit_calendar_changes_check
    check (jsonb_typeof(calendar_changes) = 'array')
);

create index if not exists department_timesheet_audit_period_idx
on public.department_timesheet_audit_log (department_key, year, month, created_at desc);

alter table public.department_timesheet_audit_log enable row level security;

drop policy if exists department_timesheet_audit_owner_select
on public.department_timesheet_audit_log;

create policy department_timesheet_audit_owner_select
on public.department_timesheet_audit_log
for select
to authenticated
using (public.is_owner());

revoke all on public.department_timesheet_audit_log from public, anon, authenticated;
grant select on public.department_timesheet_audit_log to authenticated;

create or replace function public._timesheet_employee_day_state(
  p_payload jsonb,
  p_index integer
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'day', coalesce(nullif(p_payload -> 'dayHours' ->> p_index, ''), '0'),
    'night', coalesce(nullif(p_payload -> 'nightHours' ->> p_index, ''), '0'),
    'leave', coalesce(p_payload -> 'leaveType' ->> p_index, ''),
    'comment', coalesce(p_payload -> 'shiftComments' ->> p_index, '')
  );
$$;

create or replace function public._timesheet_calendar_day_state(
  p_payload jsonb,
  p_index integer
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'holiday', coalesce((p_payload -> 'isHoliday' ->> p_index)::boolean, false),
    'transferred', coalesce((p_payload -> 'isTransferredOff' ->> p_index)::boolean, false),
    'short', coalesce((p_payload -> 'isShortDay' ->> p_index)::boolean, false)
  );
$$;

revoke all on function public._timesheet_employee_day_state(jsonb, integer)
from public, anon, authenticated;
revoke all on function public._timesheet_calendar_day_state(jsonb, integer)
from public, anon, authenticated;

create or replace function public.managed_save_department_timesheets(
  p_department_key text,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_department_key text := nullif(btrim(p_department_key), '');
  v_item jsonb;
  v_user_id uuid;
  v_user_id_raw text;
  v_year integer;
  v_month integer;
  v_event_year integer;
  v_event_month integer;
  v_days integer;
  v_index integer;
  v_payload jsonb;
  v_old_payload jsonb;
  v_before jsonb;
  v_after jsonb;
  v_day_changes jsonb;
  v_employee_changes jsonb := '[]'::jsonb;
  v_calendar_changes jsonb := '[]'::jsonb;
  v_employee_name text;
  v_changed_count integer := 0;
  v_item_count integer;
begin
  if v_actor is null then
    raise exception 'NO_SESSION';
  end if;

  if v_department_key is null then
    raise exception 'DEPARTMENT_REQUIRED';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_TIMESHEET_ITEMS';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 500 then
    raise exception 'INVALID_TIMESHEET_ITEM_COUNT';
  end if;

  if (
    select count(distinct item ->> 'user_id')
    from jsonb_array_elements(p_items) as source(item)
  ) <> v_item_count then
    raise exception 'DUPLICATE_TIMESHEET_USERS';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'INVALID_TIMESHEET_ITEM';
    end if;

    v_user_id_raw := nullif(btrim(v_item ->> 'user_id'), '');
    if v_user_id_raw is null
       or v_user_id_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'INVALID_USER_ID';
    end if;
    v_user_id := v_user_id_raw::uuid;

    if coalesce(v_item ->> 'year', '') !~ '^[0-9]{4}$'
       or coalesce(v_item ->> 'month', '') !~ '^[0-9]{1,2}$' then
      raise exception 'INVALID_TIMESHEET_PERIOD';
    end if;
    v_year := (v_item ->> 'year')::integer;
    v_month := (v_item ->> 'month')::integer;
    if v_year < 2000 or v_year > 2100 or v_month < 0 or v_month > 11 then
      raise exception 'INVALID_TIMESHEET_PERIOD';
    end if;

    if v_event_year is null then
      v_event_year := v_year;
      v_event_month := v_month;
    elsif v_year <> v_event_year or v_month <> v_event_month then
      raise exception 'MIXED_TIMESHEET_PERIODS';
    end if;

    v_payload := v_item -> 'payload';
    if v_payload is null or jsonb_typeof(v_payload) <> 'object' then
      raise exception 'INVALID_TIMESHEET_PAYLOAD';
    end if;

    if not exists (
      select 1
      from public.department_members member
      where member.department_key = v_department_key
        and member.user_id = v_user_id
    ) then
      raise exception 'MEMBER_NOT_FOUND';
    end if;

    select timesheet.payload
    into v_old_payload
    from public.timesheets timesheet
    where timesheet.user_id = v_user_id
      and timesheet.year = v_year
      and timesheet.month = v_month;

    v_old_payload := coalesce(v_old_payload, '{}'::jsonb);
    if v_old_payload = v_payload then
      continue;
    end if;

    v_days := extract(day from (make_date(v_year, v_month + 1, 1) + interval '1 month - 1 day'))::integer;
    v_day_changes := '[]'::jsonb;

    for v_index in 0..v_days - 1 loop
      v_before := public._timesheet_employee_day_state(v_old_payload, v_index);
      v_after := public._timesheet_employee_day_state(v_payload, v_index);
      if v_before <> v_after then
        v_day_changes := v_day_changes || jsonb_build_array(jsonb_build_object(
          'day', v_index + 1,
          'before', v_before,
          'after', v_after
        ));
      end if;

      if v_changed_count = 0 then
        v_before := public._timesheet_calendar_day_state(v_old_payload, v_index);
        v_after := public._timesheet_calendar_day_state(v_payload, v_index);
        if v_before <> v_after then
          v_calendar_changes := v_calendar_changes || jsonb_build_array(jsonb_build_object(
            'day', v_index + 1,
            'before', v_before,
            'after', v_after
          ));
        end if;
      end if;
    end loop;

    select coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(profile.position), ''),
      'Сотрудник'
    )
    into v_employee_name
    from public.profiles profile
    where profile.user_id = v_user_id;

    if jsonb_array_length(v_day_changes) > 0 then
      v_employee_changes := v_employee_changes || jsonb_build_array(jsonb_build_object(
        'user_id', v_user_id,
        'name', coalesce(v_employee_name, 'Сотрудник'),
        'days', v_day_changes
      ));
    end if;

    insert into public.timesheets (user_id, year, month, payload)
    values (v_user_id, v_year, v_month, v_payload)
    on conflict (user_id, year, month)
    do update set payload = excluded.payload;

    v_changed_count := v_changed_count + 1;
  end loop;

  if jsonb_array_length(v_employee_changes) > 0
     or jsonb_array_length(v_calendar_changes) > 0 then
    insert into public.department_timesheet_audit_log (
      actor_user_id,
      department_key,
      year,
      month,
      employee_changes,
      calendar_changes
    ) values (
      v_actor,
      v_department_key,
      v_event_year,
      v_event_month,
      v_employee_changes,
      v_calendar_changes
    );
  end if;

  return v_changed_count;
end;
$$;

revoke all on function public.managed_save_department_timesheets(text, jsonb)
from public, anon;
grant execute on function public.managed_save_department_timesheets(text, jsonb)
to authenticated;

create or replace function public.owner_list_department_timesheet_audit(
  p_department_key text,
  p_year integer,
  p_month integer,
  p_limit integer default 50
)
returns table (
  id bigint,
  actor_user_id uuid,
  actor_name text,
  department_key text,
  department_name text,
  year integer,
  month integer,
  employee_changes jsonb,
  calendar_changes jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;
  if not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;
  if nullif(btrim(p_department_key), '') is null
     or p_year < 2000 or p_year > 2100
     or p_month < 0 or p_month > 11 then
    raise exception 'INVALID_AUDIT_FILTER';
  end if;

  return query
  select
    audit.id,
    audit.actor_user_id,
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(profile.position), ''),
      'Пользователь'
    ) as actor_name,
    audit.department_key,
    coalesce(department.name, audit.department_key) as department_name,
    audit.year,
    audit.month,
    audit.employee_changes,
    audit.calendar_changes,
    audit.created_at
  from public.department_timesheet_audit_log audit
  left join public.profiles profile on profile.user_id = audit.actor_user_id
  left join public.departments department on department.key = audit.department_key
  where audit.department_key = btrim(p_department_key)
    and audit.year = p_year
    and audit.month = p_month
  order by audit.created_at desc, audit.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.owner_list_department_timesheet_audit(text, integer, integer, integer)
from public, anon;
grant execute on function public.owner_list_department_timesheet_audit(text, integer, integer, integer)
to authenticated;

commit;
