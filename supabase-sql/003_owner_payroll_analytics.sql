-- Payroll analytics for confirmed factual money values.
-- Requires existing timesheets/profiles/departments and owner helper functions.

create or replace function public.owner_list_payroll_analytics(
  p_year integer default null,
  p_department_key text default null
)
returns table (
  user_id uuid,
  display_name text,
  "position" text,
  tab_number text,
  department_key text,
  department_name text,
  year integer,
  month integer,
  updated_at timestamptz,
  confirmed_at timestamptz,
  status text,
  calculated_net numeric,
  actual_net numeric,
  net_diff numeric,
  net_diff_percent numeric,
  calculated_advance numeric,
  actual_advance numeric,
  advance_diff numeric,
  advance_diff_percent numeric,
  calculated_remaining numeric,
  actual_remaining numeric,
  remaining_diff numeric,
  remaining_diff_percent numeric,
  paid_leave_net numeric,
  paid_leave_tax numeric,
  calculated_tax numeric,
  worked_hours numeric,
  worked_night_hours numeric,
  month_norm numeric,
  personal_norm numeric,
  holiday_extra_gross numeric,
  holiday_days integer,
  holiday_hours numeric,
  leave_days integer
)
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

  if not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;

  return query
  with base as (
    select
      t.user_id,
      t.year as sheet_year,
      t.month as sheet_month,
      t.updated_at,
      t.payload,
      p.display_name,
      p.position,
      p.tab_number,
      dept.department_key,
      dept.department_name,
      coalesce(t.payload #> '{paySummary,calculated}', '{}'::jsonb) as calculated,
      coalesce(t.payload #> '{paySummary,actual}', '{}'::jsonb) as actual,
      coalesce(t.payload #>> '{paySummary,status}', 'draft') as pay_status,
      holiday_stats.holiday_days,
      holiday_stats.holiday_hours,
      leave_stats.leave_days
    from public.timesheets t
    left join public.profiles p on p.user_id = t.user_id
    left join lateral (
      select dm.department_key, d.name as department_name
      from public.department_members dm
      left join public.departments d on d.key = dm.department_key
      where dm.user_id = t.user_id
      order by dm.created_at asc, dm.department_key asc
      limit 1
    ) dept on true
    left join lateral (
      select
        count(*) filter (where h.value = 'true'::jsonb)::integer as holiday_days,
        coalesce(
          sum(
            case when h.value = 'true'::jsonb then
              coalesce(nullif(dh.value #>> '{}', '')::numeric, 0) +
              coalesce(nullif(nh.value #>> '{}', '')::numeric, 0)
            else 0 end
          ),
          0
        ) as holiday_hours
      from jsonb_array_elements(coalesce(t.payload->'isHoliday', '[]'::jsonb)) with ordinality h(value, ord)
      left join jsonb_array_elements(coalesce(t.payload->'dayHours', '[]'::jsonb)) with ordinality dh(value, ord)
        on dh.ord = h.ord
      left join jsonb_array_elements(coalesce(t.payload->'nightHours', '[]'::jsonb)) with ordinality nh(value, ord)
        on nh.ord = h.ord
    ) holiday_stats on true
    left join lateral (
      select count(*)::integer as leave_days
      from jsonb_array_elements_text(coalesce(t.payload->'leaveType', '[]'::jsonb)) lt(value)
      where nullif(btrim(lt.value), '') is not null
    ) leave_stats on true
    where
      (p_year is null or t.year = p_year)
      and (
        v_department_key is null
        or exists (
          select 1
          from public.department_members dm_filter
          where dm_filter.user_id = t.user_id
            and dm_filter.department_key = v_department_key
        )
      )
  ),
  extracted as (
    select
      b.user_id,
      coalesce(nullif(btrim(b.display_name), ''), nullif(btrim(b.position), ''), 'Сотрудник') as display_name,
      coalesce(b.position, '') as position_name,
      coalesce(b.tab_number, '') as tab_number,
      b.department_key,
      b.department_name,
      b.sheet_year,
      b.sheet_month,
      b.updated_at,
      nullif(b.actual->>'confirmedAt', '')::timestamptz as confirmed_at,
      b.pay_status,
      coalesce(
        nullif(b.calculated->>'net', '')::numeric,
        nullif(b.payload #>> '{paySummary,net}', '')::numeric
      ) as calculated_net,
      case
        when nullif(b.actual->>'net', '') is not null then nullif(b.actual->>'net', '')::numeric
        when nullif(b.actual->>'advance', '') is not null
          or nullif(b.actual->>'remaining', '') is not null
          then
            coalesce(nullif(b.actual->>'advance', '')::numeric, 0) +
            coalesce(nullif(b.actual->>'remaining', '')::numeric, 0)
        else null
      end as actual_net,
      nullif(b.calculated->>'advance', '')::numeric as calculated_advance,
      nullif(b.actual->>'advance', '')::numeric as actual_advance,
      nullif(b.calculated->>'remaining', '')::numeric as calculated_remaining,
      nullif(b.actual->>'remaining', '')::numeric as actual_remaining,
      nullif(b.actual->>'paidLeaveNet', '')::numeric as paid_leave_net,
      nullif(b.actual->>'paidLeaveTax', '')::numeric as paid_leave_tax,
      coalesce(
        nullif(b.calculated->>'tax', '')::numeric,
        nullif(b.payload #>> '{paySummary,tax}', '')::numeric
      ) as calculated_tax,
      nullif(b.calculated->>'workedHours', '')::numeric as worked_hours,
      nullif(b.calculated->>'workedNightHours', '')::numeric as worked_night_hours,
      nullif(b.calculated->>'monthNorm', '')::numeric as month_norm,
      nullif(b.calculated->>'personalNorm', '')::numeric as personal_norm,
      nullif(b.calculated->>'holidayExtraGross', '')::numeric as holiday_extra_gross,
      coalesce(b.holiday_days, 0) as holiday_days,
      coalesce(b.holiday_hours, 0) as holiday_hours,
      coalesce(b.leave_days, 0) as leave_days
    from base b
    where
      nullif(b.actual->>'confirmedAt', '') is not null
      and (
        nullif(b.actual->>'net', '') is not null
        or nullif(b.actual->>'advance', '') is not null
        or nullif(b.actual->>'remaining', '') is not null
        or nullif(b.actual->>'paidLeaveNet', '') is not null
        or nullif(b.actual->>'paidLeaveTax', '') is not null
      )
  )
  select
    e.user_id,
    e.display_name,
    e.position_name as "position",
    e.tab_number,
    e.department_key,
    e.department_name,
    e.sheet_year as year,
    e.sheet_month as month,
    e.updated_at,
    e.confirmed_at,
    e.pay_status as status,
    e.calculated_net,
    e.actual_net,
    e.actual_net - e.calculated_net as net_diff,
    case
      when e.calculated_net is null or e.calculated_net = 0 then null
      else round(((e.actual_net - e.calculated_net) / e.calculated_net) * 100, 2)
    end as net_diff_percent,
    e.calculated_advance,
    e.actual_advance,
    e.actual_advance - e.calculated_advance as advance_diff,
    case
      when e.calculated_advance is null or e.calculated_advance = 0 then null
      else round(((e.actual_advance - e.calculated_advance) / e.calculated_advance) * 100, 2)
    end as advance_diff_percent,
    e.calculated_remaining,
    e.actual_remaining,
    e.actual_remaining - e.calculated_remaining as remaining_diff,
    case
      when e.calculated_remaining is null or e.calculated_remaining = 0 then null
      else round(((e.actual_remaining - e.calculated_remaining) / e.calculated_remaining) * 100, 2)
    end as remaining_diff_percent,
    e.paid_leave_net,
    e.paid_leave_tax,
    e.calculated_tax,
    e.worked_hours,
    e.worked_night_hours,
    e.month_norm,
    e.personal_norm,
    e.holiday_extra_gross,
    e.holiday_days,
    e.holiday_hours,
    e.leave_days
  from extracted e
  order by
    e.sheet_year desc,
    e.sheet_month desc,
    abs(coalesce(e.actual_net - e.calculated_net, 0)) desc,
    e.display_name asc;
end;
$$;

revoke all on function public.owner_list_payroll_analytics(integer, text) from public;
grant execute on function public.owner_list_payroll_analytics(integer, text) to authenticated;
