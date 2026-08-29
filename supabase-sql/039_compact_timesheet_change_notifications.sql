-- Keep personal schedule notifications compact and show only the current state.

begin;

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
  if not exists (select 1 from public.departments where key = v_department_key) then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_changes) as change_row(user_id uuid, summary text)
    where change_row.user_id is not null
      and not exists (
        select 1
        from public.department_members member
        where member.department_key = v_department_key
          and member.user_id = change_row.user_id
      )
  ) then
    raise exception 'RECIPIENT_NOT_IN_DEPARTMENT';
  end if;

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
    'Изменение графика',
    'Ваш график изменился.' || case
      when requested.summary is null then ' Откройте табель, чтобы посмотреть актуальные смены.'
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
  join public.department_members member
    on member.department_key = v_department_key
   and member.user_id = requested.user_id;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.notify_personal_timesheet_changes(text, integer, integer, jsonb) from public, anon;
grant execute on function public.notify_personal_timesheet_changes(text, integer, integer, jsonb) to authenticated;

commit;
