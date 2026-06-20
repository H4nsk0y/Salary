create or replace function public.list_department_shift_overview(
  p_department_key text default null,
  p_start_date date default current_date,
  p_days integer default 2
)
returns table (
  department_key text,
  department_name text,
  target_date date,
  day_index integer,
  user_id uuid,
  display_name text,
  position_name text,
  tab_number text,
  avatar_url text,
  day_hours numeric,
  night_hours numeric,
  leave_type text,
  has_timesheet boolean,
  shift_status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
  v_start_date date := coalesce(p_start_date, current_date);
  v_days integer := greatest(1, least(coalesce(p_days, 2), 7));
  v_can_view_details boolean := false;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_department_key is null then
    select dm.department_key
    into v_department_key
    from public.department_members dm
    where dm.user_id = auth.uid()
    order by dm.created_at asc
    limit 1;
  end if;

  if v_department_key is null then
    select de.department_key
    into v_department_key
    from public.department_editors de
    where de.user_id = auth.uid()
    order by de.created_at asc
    limit 1;
  end if;

  if v_department_key is null then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  if not exists (select 1 from public.departments d where d.key = v_department_key) then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  v_can_view_details := public.is_owner()
    or exists (
      select 1
      from public.department_members viewer_member
      where viewer_member.user_id = auth.uid()
        and viewer_member.department_key = v_department_key
    )
    or exists (
      select 1
      from public.department_editors viewer_editor
      where viewer_editor.user_id = auth.uid()
        and viewer_editor.department_key = v_department_key
    );

  return query
  with target_dates as (
    select
      (v_start_date + gs.day_offset)::date as target_date,
      (extract(day from (v_start_date + gs.day_offset)::date)::integer - 1) as day_index,
      extract(year from (v_start_date + gs.day_offset)::date)::integer as target_year,
      (extract(month from (v_start_date + gs.day_offset)::date)::integer - 1) as target_month
    from generate_series(0, v_days - 1) as gs(day_offset)
  ),
  members as (
    select
      dm.department_key,
      dm.user_id,
      dm.created_at,
      p.display_name,
      p.position,
      p.tab_number,
      p.avatar_url
    from public.department_members dm
    left join public.profiles p on p.user_id = dm.user_id
    where dm.department_key = v_department_key
  )
  select
    m.department_key,
    d.name as department_name,
    td.target_date,
    td.day_index,
    m.user_id,
    coalesce(nullif(btrim(m.display_name), ''), nullif(btrim(m.position), ''), 'Сотрудник') as display_name,
    coalesce(m.position, '') as position_name,
    case when v_can_view_details then coalesce(m.tab_number, '') else '' end as tab_number,
    m.avatar_url,
    parsed.day_hours,
    parsed.night_hours,
    parsed.leave_type,
    (t.payload is not null) as has_timesheet,
    case
      when parsed.leave_type is not null then 'leave'
      when (parsed.day_hours + parsed.night_hours) > 0 then 'work'
      when t.payload is not null then 'off'
      else 'not_filled'
    end as shift_status
  from target_dates td
  cross join members m
  join public.departments d on d.key = m.department_key
  left join public.timesheets t
    on t.user_id = m.user_id
   and t.year = td.target_year
   and t.month = td.target_month
  left join lateral (
    select
      t.payload -> 'dayHours' ->> td.day_index as day_raw,
      t.payload -> 'nightHours' ->> td.day_index as night_raw,
      t.payload -> 'leaveType' ->> td.day_index as leave_raw
  ) raw on true
  left join lateral (
    select
      case
        when raw.day_raw ~ '^-?[0-9]+([.][0-9]+)?$' then raw.day_raw::numeric
        else 0::numeric
      end as day_hours,
      case
        when raw.night_raw ~ '^-?[0-9]+([.][0-9]+)?$' then raw.night_raw::numeric
        else 0::numeric
      end as night_hours,
      nullif(btrim(raw.leave_raw), '') as leave_type
  ) parsed on true
  order by
    td.target_date,
    case
      when (parsed.day_hours + parsed.night_hours) > 0 then 0
      when parsed.leave_type is not null then 1
      when t.payload is not null then 2
      else 3
    end,
    coalesce(nullif(btrim(m.display_name), ''), nullif(btrim(m.position), ''), m.user_id::text);
end;
$$;

revoke all on function public.list_department_shift_overview(text, date, integer) from public;
grant execute on function public.list_department_shift_overview(text, date, integer) to authenticated;
