-- Safe department-wide checklist progress for the live shift screen.
begin;

create or replace function public.list_department_active_checklists()
returns table (
  user_id uuid,
  display_name text,
  completed_count integer,
  total_count integer,
  started_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_department_key text;
begin
  if v_user_id is null then
    raise exception 'NO_SESSION';
  end if;

  select source.department_key
  into v_department_key
  from (
    select member.department_key, member.created_at, 1 as priority
    from public.department_members member
    where member.user_id = v_user_id
    union all
    select editor.department_key, editor.created_at, 2 as priority
    from public.department_editors editor
    where editor.user_id = v_user_id
  ) source
  order by source.priority, source.created_at
  limit 1;

  if v_department_key is null then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  return query
  select
    checklist.user_id,
    coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.position), ''), 'Сотрудник') as display_name,
    count(*) filter (where coalesce((item.value ->> 'done')::boolean, false))::integer as completed_count,
    count(*)::integer as total_count,
    checklist.started_at
  from public.shift_checklists checklist
  join public.department_members member
    on member.user_id = checklist.user_id
   and member.department_key = v_department_key
  left join public.profiles profile on profile.user_id = checklist.user_id
  left join lateral jsonb_array_elements(checklist.items) item(value) on true
  where checklist.department_key = v_department_key
    and checklist.status = 'active'
    and checklist.started_at >= now() - interval '36 hours'
  group by checklist.id, checklist.user_id, profile.display_name, profile.position, checklist.started_at
  order by checklist.started_at, display_name;
end;
$$;

revoke all on function public.list_department_active_checklists() from public, anon;
grant execute on function public.list_department_active_checklists() to authenticated;

commit;
