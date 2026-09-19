begin;

create or replace function public.owner_search_department_timesheet_audit(
  p_department_key text,
  p_year integer,
  p_month integer,
  p_query text,
  p_limit integer default 200
)
returns table (
  id bigint,
  actor_user_id uuid,
  actor_name text,
  department_key text,
  department_name text,
  year integer,
  month integer,
  employee_changes jsonb,
  calendar_changes jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := lower(translate(nullif(btrim(p_query), ''), 'Ёё', 'Ее'));
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;
  if not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;
  if nullif(btrim(p_department_key), '') is null
     or p_year < 2000 or p_year > 2100
     or p_month < 0 or p_month > 11
     or v_query is null then
    raise exception 'INVALID_AUDIT_FILTER';
  end if;

  return query
  select
    audit.id,
    audit.actor_user_id,
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(profile.position), ''),
      'Пользователь'
    ) as actor_name,
    audit.department_key,
    coalesce(department.name, audit.department_key) as department_name,
    audit.year,
    audit.month,
    audit.employee_changes,
    audit.calendar_changes,
    audit.created_at
  from public.department_timesheet_audit_log audit
  left join public.profiles profile on profile.user_id = audit.actor_user_id
  left join public.departments department on department.key = audit.department_key
  where audit.department_key = btrim(p_department_key)
    and audit.year = p_year
    and audit.month = p_month
    and position(v_query in lower(translate(concat_ws(
      ' ',
      profile.display_name,
      profile.position,
      audit.employee_changes::text,
      audit.calendar_changes::text
    ), 'Ёё', 'Ее'))) > 0
  order by audit.created_at desc, audit.id desc
  limit least(greatest(coalesce(p_limit, 200), 1), 200);
end;
$$;

revoke all on function public.owner_search_department_timesheet_audit(text, integer, integer, text, integer)
from public, anon;
grant execute on function public.owner_search_department_timesheet_audit(text, integer, integer, text, integer)
to authenticated;

commit;
