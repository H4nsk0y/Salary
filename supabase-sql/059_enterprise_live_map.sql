-- Aggregated live staffing map. It intentionally exposes no employee identities.
create or replace function public.list_enterprise_live_map()
returns table (
  department_key text,
  department_name text,
  branch text,
  member_count bigint,
  on_shift_count bigint,
  day_shift_count bigint,
  night_shift_count bigint,
  absent_count bigint,
  schedule_missing_count bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamp := timezone('Europe/Moscow', now());
  v_date date := v_now::date;
  v_hour integer := extract(hour from v_now)::integer;
  v_year integer := extract(year from v_date)::integer;
  v_month integer := extract(month from v_date)::integer - 1;
  v_day_index integer := extract(day from v_date)::integer - 1;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  return query
  with member_schedule as (
    select
      dm.department_key,
      d.name as department_name,
      coalesce(nullif(btrim(p.branch), ''), 'not_selected') as branch,
      t.payload is null as schedule_missing,
      nullif(btrim(t.payload -> 'leaveType' ->> v_day_index), '') as leave_type,
      case
        when (t.payload -> 'dayHours' ->> v_day_index) ~ '^[0-9]+([.][0-9]+)?$'
          then (t.payload -> 'dayHours' ->> v_day_index)::numeric
        else 0::numeric
      end as day_hours,
      case
        when (t.payload -> 'nightHours' ->> v_day_index) ~ '^[0-9]+([.][0-9]+)?$'
          then (t.payload -> 'nightHours' ->> v_day_index)::numeric
        else 0::numeric
      end as night_hours
    from public.department_members dm
    join public.departments d on d.key = dm.department_key
    left join public.profiles p on p.user_id = dm.user_id
    left join public.timesheets t
      on t.user_id = dm.user_id
     and t.year = v_year
     and t.month = v_month
  ), classified as (
    select
      source.*,
      (source.day_hours in (1, 2) and source.night_hours = 5) as night_rest,
      ((source.day_hours = 2 and source.night_hours = 2)
        or (source.day_hours in (3, 4) and source.night_hours = 7)) as night_start
    from member_schedule source
  ), live as (
    select
      source.*,
      case
        when source.leave_type is not null then false
        when v_hour < 8 then source.night_rest
        when v_hour < 20 then source.day_hours > 0 and not source.night_rest and not source.night_start
        else source.night_start
      end as on_shift,
      case
        when source.leave_type is not null then false
        when v_hour >= 8 and v_hour < 20
          then source.day_hours > 0 and not source.night_rest and not source.night_start
        else false
      end as on_day_shift,
      case
        when source.leave_type is not null then false
        when v_hour < 8 then source.night_rest
        when v_hour >= 20 then source.night_start
        else false
      end as on_night_shift
    from classified source
  )
  select
    source.department_key,
    source.department_name,
    source.branch,
    count(*) as member_count,
    count(*) filter (where source.on_shift) as on_shift_count,
    count(*) filter (where source.on_day_shift) as day_shift_count,
    count(*) filter (where source.on_night_shift) as night_shift_count,
    count(*) filter (where source.leave_type is not null) as absent_count,
    count(*) filter (where source.schedule_missing) as schedule_missing_count
  from live source
  group by source.department_key, source.department_name, source.branch
  order by source.branch, source.department_name;
end;
$$;

revoke all on function public.list_enterprise_live_map() from public, anon;
grant execute on function public.list_enterprise_live_map() to authenticated;

comment on function public.list_enterprise_live_map() is
  'Returns anonymous department staffing totals for the live enterprise map.';

create or replace function public.list_enterprise_live_workers(p_building text)
returns table (
  department_key text,
  department_name text,
  user_id uuid,
  display_name text,
  position_name text,
  day_hours numeric,
  night_hours numeric,
  shift_label text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_building text := lower(nullif(btrim(p_building), ''));
  v_now timestamp := timezone('Europe/Moscow', now());
  v_date date := v_now::date;
  v_hour integer := extract(hour from v_now)::integer;
  v_year integer := extract(year from v_date)::integer;
  v_month integer := extract(month from v_date)::integer - 1;
  v_day_index integer := extract(day from v_date)::integer - 1;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;
  if v_building not in ('production', 'office', 'odyssey') then
    raise exception 'UNKNOWN_BUILDING';
  end if;

  return query
  with schedule as (
    select
      dm.department_key,
      d.name as department_name,
      dm.user_id,
      coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.position), ''), 'Сотрудник') as display_name,
      coalesce(p.position, '') as position_name,
      p.branch,
      nullif(btrim(t.payload -> 'leaveType' ->> v_day_index), '') as leave_type,
      case
        when (t.payload -> 'dayHours' ->> v_day_index) ~ '^[0-9]+([.][0-9]+)?$'
          then (t.payload -> 'dayHours' ->> v_day_index)::numeric
        else 0::numeric
      end as day_hours,
      case
        when (t.payload -> 'nightHours' ->> v_day_index) ~ '^[0-9]+([.][0-9]+)?$'
          then (t.payload -> 'nightHours' ->> v_day_index)::numeric
        else 0::numeric
      end as night_hours
    from public.department_members dm
    join public.departments d on d.key = dm.department_key
    join public.profiles p on p.user_id = dm.user_id
    left join public.timesheets t
      on t.user_id = dm.user_id
     and t.year = v_year
     and t.month = v_month
    where
      (v_building = 'production'
        and p.branch = 'chateau_alvisa'
        and dm.department_key in ('egais', 'bottling', 'laboratory', 'warehouse', 'blending'))
      or (v_building = 'office'
        and p.branch = 'chateau_alvisa'
        and dm.department_key in ('administration', 'accounting', 'operations', 'hr'))
      or (v_building = 'odyssey' and p.branch = 'contract_odyssey')
  ), classified as (
    select
      source.*,
      (source.day_hours in (1, 2) and source.night_hours = 5) as night_rest,
      ((source.day_hours = 2 and source.night_hours = 2)
        or (source.day_hours in (3, 4) and source.night_hours = 7)) as night_start
    from schedule source
  )
  select
    source.department_key,
    source.department_name,
    source.user_id,
    source.display_name,
    source.position_name,
    source.day_hours,
    source.night_hours,
    case
      when v_hour < 8 then 'Ночная смена до 08:00'
      when v_hour < 20 then 'Дневная смена'
      else 'Ночная смена'
    end as shift_label
  from classified source
  where source.leave_type is null
    and case
      when v_hour < 8 then source.night_rest
      when v_hour < 20 then source.day_hours > 0 and not source.night_rest and not source.night_start
      else source.night_start
    end
  order by source.department_name, source.display_name;
end;
$$;

revoke all on function public.list_enterprise_live_workers(text) from public, anon;
grant execute on function public.list_enterprise_live_workers(text) to authenticated;

comment on function public.list_enterprise_live_workers(text) is
  'Returns current workers inside one interactive enterprise-map building.';
