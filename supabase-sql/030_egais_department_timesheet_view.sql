-- Read-only department timesheet for EGAIS employees.
-- The RPC returns schedule data only and never exposes salary or actual payment fields.

create or replace function public.can_view_egais_department_timesheet()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.is_owner()
      or exists (
        select 1
        from public.department_members dm
        where dm.user_id = auth.uid()
          and dm.department_key = 'egais'
      )
      or exists (
        select 1
        from public.department_editors de
        where de.user_id = auth.uid()
          and de.department_key = 'egais'
      )
    );
$$;

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

revoke all on function public.can_view_egais_department_timesheet() from public;
revoke all on function public.can_view_egais_department_timesheet() from anon;
revoke all on function public.list_egais_department_timesheet_view(integer, integer) from public;
revoke all on function public.list_egais_department_timesheet_view(integer, integer) from anon;

grant execute on function public.can_view_egais_department_timesheet() to authenticated;
grant execute on function public.list_egais_department_timesheet_view(integer, integer) to authenticated;
