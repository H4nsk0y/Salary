-- Keep the EGAIS read-only view aligned with saved department calendar marks,
-- and allow department editors to remove ordinary members from their department.

create or replace function public.list_egais_department_timesheet_view(
  p_year integer,
  p_month integer
)
returns table (
  user_id uuid,
  display_name text,
  position_name text,
  gender text,
  branch text,
  employment_date date,
  weekly_hours numeric,
  sort_order integer,
  payload jsonb,
  dismissed_before_month boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_egais_department_timesheet() then
    raise exception 'ACCESS_DENIED';
  end if;

  if p_year is null or p_month is null
    or p_year < 2000 or p_year > 2100
    or p_month < 0 or p_month > 11 then
    raise exception 'INVALID_PERIOD';
  end if;

  return query
  select
    dm.user_id,
    coalesce(
      nullif(btrim(p.display_name), ''),
      nullif(btrim(p.position), ''),
      'Сотрудник'
    ) as display_name,
    coalesce(p.position, '') as position_name,
    p.gender,
    p.branch,
    p.employment_date,
    p.weekly_hours,
    dm.sort_order,
    case
      when t.payload is null then null
      else jsonb_strip_nulls(jsonb_build_object(
        'v', t.payload -> 'v',
        'year', t.payload -> 'year',
        'month', t.payload -> 'month',
        'sharedMarksSource', t.payload -> 'sharedMarksSource',
        'sharedMarksDepartmentKey', t.payload -> 'sharedMarksDepartmentKey',
        'productionCalendarVersion', t.payload -> 'productionCalendarVersion',
        'isHoliday', t.payload -> 'isHoliday',
        'isTransferredOff', t.payload -> 'isTransferredOff',
        'isShortDay', t.payload -> 'isShortDay',
        'dayHours', t.payload -> 'dayHours',
        'nightHours', t.payload -> 'nightHours',
        'leaveType', t.payload -> 'leaveType',
        'shiftComments', t.payload -> 'shiftComments',
        'normSnapshot', t.payload -> 'normSnapshot'
      ))
    end as payload,
    exists (
      select 1
      from public.timesheets previous
      where previous.user_id = dm.user_id
        and (
          previous.year < p_year
          or (previous.year = p_year and previous.month < p_month)
        )
        and coalesce(previous.payload -> 'leaveType', '[]'::jsonb) ? 'dismissed'
    ) as dismissed_before_month
  from public.department_members dm
  left join public.profiles p on p.user_id = dm.user_id
  left join public.timesheets t
    on t.user_id = dm.user_id
   and t.year = p_year
   and t.month = p_month
  where dm.department_key = 'egais'
  order by
    coalesce(dm.sort_order, 2147483647),
    dm.created_at,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.position), ''), dm.user_id::text);
end;
$$;

create or replace function public.remove_managed_department_member(
  p_department_key text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_department_key is null or p_user_id is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'CANNOT_REMOVE_SELF';
  end if;

  if not exists (
    select 1 from public.department_members dm
    where dm.department_key = v_department_key and dm.user_id = p_user_id
  ) then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.user_id = p_user_id and p.role = 'owner'
  ) or exists (
    select 1 from public.department_editors de
    where de.user_id = p_user_id and de.department_key = v_department_key
  ) then
    raise exception 'PROTECTED_MEMBER';
  end if;

  delete from public.department_members dm
  where dm.department_key = v_department_key
    and dm.user_id = p_user_id;
end;
$$;

revoke all on function public.list_egais_department_timesheet_view(integer, integer) from public;
revoke all on function public.list_egais_department_timesheet_view(integer, integer) from anon;
grant execute on function public.list_egais_department_timesheet_view(integer, integer) to authenticated;

revoke all on function public.remove_managed_department_member(text, uuid) from public;
revoke all on function public.remove_managed_department_member(text, uuid) from anon;
grant execute on function public.remove_managed_department_member(text, uuid) to authenticated;
