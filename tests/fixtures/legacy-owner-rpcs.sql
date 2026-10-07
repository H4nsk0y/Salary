-- Legacy definitions supplied from the production RPC inventory; no user data.
create or replace function public.owner_add_department_editor(p_department_key text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if not public.can_edit_department(p_department_key) then raise exception 'ACCESS_DENIED'; end if;
  if p_user_id is null then raise exception 'USER_ID_REQUIRED'; end if;
  insert into public.department_editors (department_key, user_id)
  values (p_department_key, p_user_id) on conflict do nothing;
end;
$$;

create or replace function public.owner_remove_department_editor(p_department_key text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if not public.can_edit_department(p_department_key) then raise exception 'ACCESS_DENIED'; end if;
  delete from public.department_editors where department_key = p_department_key and user_id = p_user_id;
end;
$$;

create or replace function public.owner_add_department_member(p_department_key text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if not public.can_edit_department(p_department_key) then raise exception 'ACCESS_DENIED'; end if;
  if p_user_id is null then raise exception 'USER_ID_REQUIRED'; end if;
  if exists (select 1 from public.department_members where user_id = p_user_id and department_key <> p_department_key) then
    raise exception 'USER_ALREADY_IN_ANOTHER_DEPARTMENT';
  end if;
  insert into public.department_members (department_key, user_id)
  values (p_department_key, p_user_id) on conflict do nothing;
end;
$$;

create or replace function public.owner_remove_department_member(p_department_key text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if not public.can_edit_department(p_department_key) then raise exception 'ACCESS_DENIED'; end if;
  delete from public.department_members where department_key = p_department_key and user_id = p_user_id;
end;
$$;

create or replace function public.owner_list_available_profiles(p_department_key text)
returns table (user_id uuid, display_name text, position_name text, tab_number text, role text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if not public.can_edit_department(p_department_key) then raise exception 'ACCESS_DENIED'; end if;
  return query select p.user_id,
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.position), ''), 'Сотрудник'),
    coalesce(p.position, ''), coalesce(p.tab_number, ''), coalesce(p.role, 'user'), p.created_at
  from public.profiles p
  where not exists (select 1 from public.department_members m where m.user_id = p.user_id)
  order by coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.position), ''), p.user_id::text), p.created_at;
end;
$$;

create or replace function public.owner_list_department_editors(p_department_key text)
returns table (user_id uuid, display_name text, position_name text, tab_number text, role text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if not public.can_edit_department(p_department_key) then raise exception 'ACCESS_DENIED'; end if;
  return query select e.user_id,
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.position), ''), 'Сотрудник'),
    coalesce(p.position, ''), coalesce(p.tab_number, ''), coalesce(p.role, 'user'), e.created_at
  from public.department_editors e left join public.profiles p on p.user_id = e.user_id
  where e.department_key = p_department_key
  order by coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.position), ''), e.user_id::text), e.created_at;
end;
$$;

grant execute on function public.owner_add_department_editor(text, uuid),
public.owner_remove_department_editor(text, uuid), public.owner_add_department_member(text, uuid),
public.owner_remove_department_member(text, uuid), public.owner_list_available_profiles(text),
public.owner_list_department_editors(text) to authenticated;
