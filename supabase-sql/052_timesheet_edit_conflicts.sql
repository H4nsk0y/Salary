-- Prevent one department editor from silently overwriting a newer save.
-- The existing audited save remains the only function that writes timesheets.

create or replace function public.managed_save_department_timesheets_v2(
  p_department_key text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_department_key text := nullif(btrim(p_department_key), '');
  v_item jsonb;
  v_user_id uuid;
  v_year integer;
  v_month integer;
  v_expected_raw text;
  v_expected_updated_at timestamptz;
  v_actual_updated_at timestamptz;
  v_row_exists boolean;
  v_changed_count integer;
  v_versions jsonb;
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

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 500 then
    raise exception 'INVALID_TIMESHEET_ITEMS';
  end if;

  -- Old cached clients remain compatible until their page refreshes.
  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by value ->> 'user_id'
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'INVALID_TIMESHEET_ITEM';
    end if;

    if not (v_item ? 'expected_updated_at') then
      continue;
    end if;

    begin
      v_user_id := nullif(btrim(v_item ->> 'user_id'), '')::uuid;
      v_year := (v_item ->> 'year')::integer;
      v_month := (v_item ->> 'month')::integer;
      v_expected_raw := nullif(btrim(v_item ->> 'expected_updated_at'), '');
      v_expected_updated_at := case
        when v_expected_raw is null then null
        else v_expected_raw::timestamptz
      end;
    exception when others then
      raise exception 'INVALID_EXPECTED_VERSION';
    end;

    -- Also serializes the first insert, where no database row exists to lock yet.
    perform pg_advisory_xact_lock(
      hashtextextended(format('%s:%s:%s', v_user_id, v_year, v_month), 0)
    );

    select timesheet.updated_at
    into v_actual_updated_at
    from public.timesheets timesheet
    where timesheet.user_id = v_user_id
      and timesheet.year = v_year
      and timesheet.month = v_month
    for update;

    v_row_exists := found;

    if (v_expected_updated_at is null and v_row_exists)
       or (v_expected_updated_at is not null and not v_row_exists)
       or (v_expected_updated_at is not null and v_actual_updated_at is distinct from v_expected_updated_at) then
      raise exception 'TIMESHEET_CONFLICT';
    end if;
  end loop;

  v_changed_count := public.managed_save_department_timesheets(v_department_key, p_items);

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'user_id', timesheet.user_id,
      'updated_at', timesheet.updated_at
    )),
    '[]'::jsonb
  )
  into v_versions
  from public.timesheets timesheet
  join (
    select
      (item ->> 'user_id')::uuid as user_id,
      (item ->> 'year')::integer as year,
      (item ->> 'month')::integer as month
    from jsonb_array_elements(p_items) as source(item)
  ) requested
    on requested.user_id = timesheet.user_id
   and requested.year = timesheet.year
   and requested.month = timesheet.month;

  return jsonb_build_object(
    'changed_count', v_changed_count,
    'versions', v_versions
  );
end;
$$;

revoke all on function public.managed_save_department_timesheets_v2(text, jsonb)
from public, anon;
grant execute on function public.managed_save_department_timesheets_v2(text, jsonb)
to authenticated;
