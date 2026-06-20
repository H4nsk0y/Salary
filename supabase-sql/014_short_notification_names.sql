create or replace function public.notify_personal_timesheet_changes(
  p_department_key text,
  p_year integer,
  p_month integer,
  p_changes jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
  v_department_name text;
  v_actor_display_name text;
  v_actor_position text;
  v_actor_name_parts text[];
  v_actor_name text;
  v_month_label text;
  v_inserted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_department_key is null then
    raise exception 'DEPARTMENT_REQUIRED';
  end if;

  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'INVALID_YEAR';
  end if;

  if p_month is null or p_month < 0 or p_month > 11 then
    raise exception 'INVALID_MONTH';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'INVALID_CHANGES';
  end if;

  if jsonb_array_length(p_changes) > 200 then
    raise exception 'TOO_MANY_CHANGES';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  select d.name
    into v_department_name
  from public.departments d
  where d.key = v_department_key;

  if v_department_name is null then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_changes) as change_row(user_id uuid, summary text)
    where change_row.user_id is not null
      and not exists (
        select 1
        from public.department_members dm
        where dm.department_key = v_department_key
          and dm.user_id = change_row.user_id
      )
  ) then
    raise exception 'RECIPIENT_NOT_IN_DEPARTMENT';
  end if;

  select
    nullif(regexp_replace(btrim(p.display_name), '\s+', ' ', 'g'), ''),
    nullif(btrim(p.position), '')
  into v_actor_display_name, v_actor_position
  from public.profiles p
  where p.user_id = auth.uid();

  if v_actor_display_name is not null then
    v_actor_name_parts := regexp_split_to_array(v_actor_display_name, '\s+');

    if cardinality(v_actor_name_parts) >= 3 then
      v_actor_name := v_actor_name_parts[1] || ' '
        || upper(left(v_actor_name_parts[2], 1)) || '.'
        || upper(left(v_actor_name_parts[3], 1)) || '.';
    elsif cardinality(v_actor_name_parts) = 2 then
      v_actor_name := v_actor_name_parts[1] || ' '
        || upper(left(v_actor_name_parts[2], 1)) || '.';
    else
      v_actor_name := v_actor_name_parts[1];
    end if;
  else
    v_actor_name := coalesce(v_actor_position, 'Сотрудник');
  end if;

  v_month_label := case p_month
    when 0 then 'январь'
    when 1 then 'февраль'
    when 2 then 'март'
    when 3 then 'апрель'
    when 4 then 'май'
    when 5 then 'июнь'
    when 6 then 'июль'
    when 7 then 'август'
    when 8 then 'сентябрь'
    when 9 then 'октябрь'
    when 10 then 'ноябрь'
    when 11 then 'декабрь'
    else 'месяц'
  end;

  insert into public.user_notifications (
    user_id,
    actor_user_id,
    department_key,
    type,
    title,
    body,
    url,
    expires_at
  )
  select
    requested.user_id,
    auth.uid(),
    v_department_key,
    'personal_timesheet_changed',
    'Ваш табель изменён',
    v_actor_name || ': изменён ваш табель за ' || v_month_label || ' ' || p_year || '.' ||
      case
        when requested.summary is null then ''
        else ' ' || left(requested.summary, 900)
      end,
    'table.html?year=' || p_year || '&month=' || p_month,
    now() + interval '7 days'
  from (
    select distinct on (change_row.user_id)
      change_row.user_id,
      nullif(btrim(change_row.summary), '') as summary
    from jsonb_to_recordset(p_changes) as change_row(user_id uuid, summary text)
    where change_row.user_id is not null
    order by change_row.user_id
  ) requested
  join public.department_members dm
    on dm.department_key = v_department_key
   and dm.user_id = requested.user_id;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.notify_personal_timesheet_changes(text, integer, integer, jsonb) from public;
grant execute on function public.notify_personal_timesheet_changes(text, integer, integer, jsonb) to authenticated;
