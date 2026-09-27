-- Yearly vacation map for authenticated members of the same department.
create or replace function public.list_department_vacation_calendar(p_year integer)
returns table (
  display_name text,
  vacation_dates jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_department_key text;
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if p_year is null or p_year < 2020 or p_year > 2100 then
    raise exception 'INVALID_VACATION_YEAR';
  end if;

  select dm.department_key into v_department_key
  from public.department_members dm
  where dm.user_id = auth.uid()
  order by dm.department_key
  limit 1;
  if v_department_key is null then return; end if;

  return query
  with department_people as (
    select
      dm.user_id,
      coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.position), ''), 'Сотрудник') as coworker_name
    from public.department_members dm
    join public.profiles p on p.user_id = dm.user_id
    where dm.department_key = v_department_key
  ), vacation_days as (
    select
      people.user_id,
      people.coworker_name,
      make_date(p_year, t.month + 1, day_index.day_number) as vacation_date
    from department_people people
    join public.timesheets t
      on t.user_id = people.user_id
     and t.year = p_year
    cross join lateral generate_series(
      1,
      extract(day from (make_date(p_year, t.month + 1, 1) + interval '1 month - 1 day'))::integer
    ) as day_index(day_number)
    where lower(btrim(coalesce(t.payload -> 'leaveType' ->> (day_index.day_number - 1), '')))
      in ('vacation', 'vac_paid', 'о', 'от')
  )
  select
    source.coworker_name,
    jsonb_agg(to_char(source.vacation_date, 'YYYY-MM-DD') order by source.vacation_date)
  from vacation_days source
  group by source.user_id, source.coworker_name
  order by source.coworker_name;
end;
$$;

revoke all on function public.list_department_vacation_calendar(integer) from public, anon;
grant execute on function public.list_department_vacation_calendar(integer) to authenticated;

comment on function public.list_department_vacation_calendar(integer) is
  'Returns paid-vacation dates from saved timesheets for members of the caller department.';
