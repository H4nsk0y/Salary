-- Requires 001_user_presence.sql.

create or replace function public.owner_list_users()
returns table (
  user_id uuid,
  display_name text,
  "position" text,
  tab_number text,
  role text,
  avatar_url text,
  created_at timestamptz,
  department_key text,
  department_name text,
  department_count integer,
  editor_department_keys text[],
  editor_department_names text[],
  last_seen timestamptz,
  page text,
  is_online boolean,
  profile_complete boolean,
  missing_fields text[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;

  return query
  select
    p.user_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.position), ''), 'Сотрудник') as display_name,
    coalesce(p.position, '') as "position",
    coalesce(p.tab_number, '') as tab_number,
    coalesce(p.role, 'user') as role,
    p.avatar_url,
    p.created_at,
    primary_department.department_key,
    primary_department.department_name,
    coalesce(member_stats.department_count, 0)::integer as department_count,
    coalesce(editor_stats.department_keys, array[]::text[]) as editor_department_keys,
    coalesce(editor_stats.department_names, array[]::text[]) as editor_department_names,
    presence.last_seen,
    presence.page,
    coalesce(presence.last_seen > now() - interval '2 minutes', false) as is_online,
    (
      nullif(btrim(p.display_name), '') is not null
      and nullif(btrim(p.position), '') is not null
      and nullif(btrim(p.gender), '') is not null
      and p.oklad is not null
    ) as profile_complete,
    array_remove(array[
      case when nullif(btrim(p.display_name), '') is null then 'Имя'::text else null::text end,
      case when nullif(btrim(p.position), '') is null then 'Должность'::text else null::text end,
      case when nullif(btrim(p.gender), '') is null then 'Пол'::text else null::text end,
      case when p.oklad is null then 'Оклад'::text else null::text end
    ], null::text) as missing_fields
  from public.profiles p
  left join lateral (
    select dm.department_key, d.name as department_name
    from public.department_members dm
    left join public.departments d on d.key = dm.department_key
    where dm.user_id = p.user_id
    order by dm.created_at asc, dm.department_key asc
    limit 1
  ) primary_department on true
  left join lateral (
    select count(*)::integer as department_count
    from public.department_members dm
    where dm.user_id = p.user_id
  ) member_stats on true
  left join lateral (
    select
      coalesce(array_agg(de.department_key order by coalesce(d.name, de.department_key)), array[]::text[]) as department_keys,
      coalesce(array_agg(coalesce(d.name, de.department_key) order by coalesce(d.name, de.department_key)), array[]::text[]) as department_names
    from public.department_editors de
    left join public.departments d on d.key = de.department_key
    where de.user_id = p.user_id
  ) editor_stats on true
  left join public.user_presence presence on presence.user_id = p.user_id
  order by
    coalesce(presence.last_seen > now() - interval '2 minutes', false) desc,
    coalesce(primary_department.department_name, 'яяя') asc,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.position), ''), p.user_id::text) asc;
end;
$$;

create or replace function public.owner_set_user_department(
  p_user_id uuid,
  p_department_key text default null
)
returns void
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

  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.user_id = p_user_id
  ) then
    raise exception 'USER_NOT_FOUND';
  end if;

  if v_department_key is not null and not exists (
    select 1 from public.departments d
    where d.key = v_department_key
  ) then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  delete from public.department_members
  where user_id = p_user_id;

  delete from public.department_editors
  where user_id = p_user_id
    and (v_department_key is null or department_key <> v_department_key);

  if v_department_key is not null then
    insert into public.department_members (department_key, user_id)
    values (v_department_key, p_user_id)
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.owner_set_department_editor(
  p_department_key text,
  p_user_id uuid,
  p_is_editor boolean
)
returns void
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

  if v_department_key is null then
    raise exception 'DEPARTMENT_REQUIRED';
  end if;

  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if p_is_editor then
    if not exists (
      select 1 from public.department_members dm
      where dm.department_key = v_department_key
        and dm.user_id = p_user_id
    ) then
      raise exception 'USER_NOT_IN_DEPARTMENT';
    end if;

    insert into public.department_editors (department_key, user_id)
    values (v_department_key, p_user_id)
    on conflict do nothing;
  else
    delete from public.department_editors
    where department_key = v_department_key
      and user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.owner_list_users() from public;
revoke all on function public.owner_set_user_department(uuid, text) from public;
revoke all on function public.owner_set_department_editor(text, uuid, boolean) from public;

grant execute on function public.owner_list_users() to authenticated;
grant execute on function public.owner_set_user_department(uuid, text) to authenticated;
grant execute on function public.owner_set_department_editor(text, uuid, boolean) to authenticated;
