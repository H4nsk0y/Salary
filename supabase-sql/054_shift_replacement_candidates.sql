-- Suggest colleagues who may be able to cover one of the caller's shifts.
-- The function is read-only and exposes no salary or full-timesheet data.

begin;

create or replace function public.find_my_shift_replacement_candidates(
  p_year integer,
  p_month integer,
  p_day integer
)
returns table (
  user_id uuid,
  display_name text,
  position_name text,
  availability text,
  priority integer
)
language plpgsql
stable
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
  v_shift_type text;
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
    and timesheet.month = p_month;

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

  if v_leave is not null then
    raise exception 'SHIFT_NOT_SCHEDULED';
  end if;

  if v_night_hours > 0 and not (v_night_hours = 5 and v_day_hours in (1, 2)) then
    v_shift_type := 'night';
  elsif v_day_hours >= 6 then
    v_shift_type := 'day';
  else
    raise exception 'SHIFT_NOT_SCHEDULED';
  end if;

  return query
  with candidate_state as (
    select
      member.user_id,
      coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.position), ''), 'Сотрудник') as display_name,
      coalesce(profile.position, '') as position_name,
      case
        when coalesce(candidate.payload -> 'dayHours' ->> v_day_index, '') ~ '^[0-9]+([.][0-9]+)?$'
          then (candidate.payload -> 'dayHours' ->> v_day_index)::numeric
        else 0
      end as day_hours,
      case
        when coalesce(candidate.payload -> 'nightHours' ->> v_day_index, '') ~ '^[0-9]+([.][0-9]+)?$'
          then (candidate.payload -> 'nightHours' ->> v_day_index)::numeric
        else 0
      end as night_hours,
      nullif(btrim(candidate.payload -> 'leaveType' ->> v_day_index), '') as leave_type,
      coalesce(constraint_row.no_night_shifts, false) as no_night_shifts,
      coalesce(member.sort_order, 2147483647) as sort_order
    from public.department_members member
    join public.timesheets candidate
      on candidate.user_id = member.user_id
     and candidate.year = p_year
     and candidate.month = p_month
    left join public.profiles profile on profile.user_id = member.user_id
    left join public.user_schedule_constraints constraint_row on constraint_row.user_id = member.user_id
    where member.department_key = v_department_key
      and member.user_id <> v_user_id
      and not exists (
        select 1
        from public.department_editors editor
        where editor.department_key = v_department_key
          and editor.user_id = member.user_id
          and editor.is_leader
      )
  )
  select
    state.user_id,
    state.display_name,
    state.position_name,
    case
      when state.day_hours = 0 and state.night_hours = 0 then 'day_off'
      else 'recovery'
    end as availability,
    case
      when state.day_hours = 0 and state.night_hours = 0 then 1
      else 2
    end as priority
  from candidate_state state
  where state.leave_type is null
    and (v_shift_type <> 'night' or not state.no_night_shifts)
    and (
      (state.day_hours = 0 and state.night_hours = 0)
      or (
        v_shift_type = 'night'
        and state.night_hours = 5
        and state.day_hours in (1, 2)
      )
    )
  order by
    case when state.day_hours = 0 and state.night_hours = 0 then 1 else 2 end,
    state.sort_order,
    state.display_name;
end;
$$;

revoke all on function public.find_my_shift_replacement_candidates(integer, integer, integer)
from public, anon;
grant execute on function public.find_my_shift_replacement_candidates(integer, integer, integer)
to authenticated;

commit;
