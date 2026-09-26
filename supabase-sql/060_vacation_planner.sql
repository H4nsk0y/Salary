-- Personal vacation balance snapshots and safe department overlap checks.
create table if not exists public.vacation_balance_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_days numeric(7, 2) not null check (balance_days between 0 and 999),
  annual_days numeric(6, 2) not null default 28 check (annual_days between 1 and 365),
  as_of_date date not null default (timezone('Europe/Moscow', now()))::date,
  updated_at timestamptz not null default now()
);

alter table public.vacation_balance_snapshots enable row level security;

drop policy if exists vacation_balance_select_own on public.vacation_balance_snapshots;
create policy vacation_balance_select_own
on public.vacation_balance_snapshots for select
to authenticated
using (user_id = auth.uid());

revoke all on table public.vacation_balance_snapshots from public, anon;
grant select on table public.vacation_balance_snapshots to authenticated;

create or replace function public.save_my_vacation_balance(
  p_balance_days numeric,
  p_annual_days numeric default 28
)
returns public.vacation_balance_snapshots
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.vacation_balance_snapshots;
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if p_balance_days is null or p_balance_days < 0 or p_balance_days > 999 then
    raise exception 'INVALID_VACATION_BALANCE';
  end if;
  if p_annual_days is null or p_annual_days < 1 or p_annual_days > 365 then
    raise exception 'INVALID_ANNUAL_VACATION_DAYS';
  end if;

  insert into public.vacation_balance_snapshots (user_id, balance_days, annual_days, as_of_date, updated_at)
  values (auth.uid(), round(p_balance_days, 2), round(p_annual_days, 2), timezone('Europe/Moscow', now())::date, now())
  on conflict (user_id) do update set
    balance_days = excluded.balance_days,
    annual_days = excluded.annual_days,
    as_of_date = excluded.as_of_date,
    updated_at = excluded.updated_at
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.list_department_vacation_overlaps(p_start date, p_end date)
returns table (
  display_name text,
  overlap_dates jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_department_key text;
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 90 then
    raise exception 'INVALID_VACATION_RANGE';
  end if;

  select dm.department_key into v_department_key
  from public.department_members dm
  where dm.user_id = auth.uid()
  order by dm.department_key
  limit 1;
  if v_department_key is null then return; end if;

  return query
  with dates as (
    select day::date as target_date
    from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') day
  ), coworker_days as (
    select
      dm.user_id,
      coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.position), ''), 'Сотрудник') as coworker_name,
      dates.target_date,
      lower(btrim(coalesce(t.payload -> 'leaveType' ->> (extract(day from dates.target_date)::integer - 1), ''))) as leave_type
    from public.department_members dm
    join public.profiles p on p.user_id = dm.user_id
    cross join dates
    left join public.timesheets t
      on t.user_id = dm.user_id
     and t.year = extract(year from dates.target_date)::integer
     and t.month = extract(month from dates.target_date)::integer - 1
    where dm.department_key = v_department_key
      and dm.user_id <> auth.uid()
  )
  select
    source.coworker_name,
    jsonb_agg(to_char(source.target_date, 'YYYY-MM-DD') order by source.target_date)
  from coworker_days source
  where source.leave_type in ('vacation', 'vac_paid', 'о', 'от')
  group by source.user_id, source.coworker_name
  order by source.coworker_name;
end;
$$;

revoke all on function public.save_my_vacation_balance(numeric, numeric) from public, anon;
revoke all on function public.list_department_vacation_overlaps(date, date) from public, anon;
grant execute on function public.save_my_vacation_balance(numeric, numeric) to authenticated;
grant execute on function public.list_department_vacation_overlaps(date, date) to authenticated;

comment on table public.vacation_balance_snapshots is
  'User-entered vacation balance snapshots used only for an approximate personal forecast.';
comment on function public.list_department_vacation_overlaps(date, date) is
  'Returns only paid-vacation dates of coworkers in the caller department for the requested range.';
