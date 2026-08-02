-- Employees of the EGAIS department keep read access to their timesheets,
-- but only the owner and department editors can change them.
-- Other departments keep the existing self-editing behavior.

create or replace function public.can_edit_timesheet(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_owner()
    or exists (
      select 1
      from public.department_editors de
      join public.department_members dm
        on dm.department_key = de.department_key
      where de.user_id = auth.uid()
        and dm.user_id = target_user_id
    )
    or (
      target_user_id = auth.uid()
      and not exists (
        select 1
        from public.department_members own_department
        where own_department.user_id = auth.uid()
          and own_department.department_key = 'egais'
      )
    );
$$;

revoke all on function public.can_edit_timesheet(uuid) from public;
grant execute on function public.can_edit_timesheet(uuid) to authenticated;

create or replace function public.save_my_timesheet_actual(
  p_year integer,
  p_month integer,
  p_actual jsonb,
  p_status text default 'draft'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if p_year < 2000 or p_year > 2100 or p_month < 0 or p_month > 11 then
    raise exception 'INVALID_PERIOD';
  end if;

  if p_actual is null or jsonb_typeof(p_actual) <> 'object' then
    raise exception 'INVALID_ACTUAL_PAYLOAD';
  end if;

  update public.timesheets t
  set payload = jsonb_set(
    coalesce(t.payload, '{}'::jsonb),
    '{paySummary}',
    coalesce(t.payload -> 'paySummary', '{}'::jsonb)
      || jsonb_build_object(
        'actual', p_actual,
        'status', coalesce(nullif(btrim(p_status), ''), 'draft')
      ),
    true
  )
  where t.user_id = auth.uid()
    and t.year = p_year
    and t.month = p_month;

  if not found then
    raise exception 'TIMESHEET_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.save_my_timesheet_actual(integer, integer, jsonb, text) from public;
grant execute on function public.save_my_timesheet_actual(integer, integer, jsonb, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'timesheets'
      and policyname = 'timesheets_egais_insert_restriction'
  ) then
    create policy "timesheets_egais_insert_restriction"
    on public.timesheets
    as restrictive
    for insert
    to authenticated
    with check (public.can_edit_timesheet(user_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'timesheets'
      and policyname = 'timesheets_egais_update_restriction'
  ) then
    create policy "timesheets_egais_update_restriction"
    on public.timesheets
    as restrictive
    for update
    to authenticated
    using (public.can_edit_timesheet(user_id))
    with check (public.can_edit_timesheet(user_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'timesheets'
      and policyname = 'timesheets_egais_delete_restriction'
  ) then
    create policy "timesheets_egais_delete_restriction"
    on public.timesheets
    as restrictive
    for delete
    to authenticated
    using (public.can_edit_timesheet(user_id));
  end if;
end $$;
