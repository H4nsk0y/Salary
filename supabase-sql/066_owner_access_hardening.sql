-- Apply after 065. No role may be assigned through an authenticated client.
begin;

alter table public.profiles enable row level security;
revoke create on schema public from public, anon, authenticated;
revoke all on public.profiles from public, anon;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
alter function public.is_owner() set search_path = public, pg_temp;
alter function public.can_edit_department(text) set search_path = public, pg_temp;

-- Table-level REVOKE alone does not remove old column-level grants.
do $$
declare field record;
begin
  for field in select attname from pg_attribute
    where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
  loop
    execute format('revoke insert (%I), update (%I) on public.profiles from public, anon, authenticated', field.attname, field.attname);
    execute format('revoke select (%I) on public.profiles from public, anon', field.attname);
  end loop;
end $$;

grant insert (
  user_id, oklad, gender, position, display_name, avatar_url, hide_money,
  money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number,
  branch, employment_date, weekly_hours, egais_file_reminders_enabled, hide_calculator_nav
) on public.profiles to authenticated;
grant update (
  user_id, oklad, gender, position, display_name, avatar_url, hide_money,
  money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number,
  branch, employment_date, weekly_hours, egais_file_reminders_enabled, hide_calculator_nav
) on public.profiles to authenticated;

create or replace function public.enforce_profile_privilege_boundary()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  avatar text := nullif(btrim(new.avatar_url), '');
  path text;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'PROFILE_USER_ID_IMMUTABLE';
  end if;
  if auth.uid() is not null or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if (tg_op = 'INSERT' and coalesce(new.role, 'user') <> 'user')
      or (tg_op = 'UPDATE' and new.role is distinct from old.role) then
      raise exception 'PROFILE_ROLE_DENIED';
    end if;
    if tg_op = 'UPDATE' and new.created_at is distinct from old.created_at then
      raise exception 'PROFILE_CREATED_AT_IMMUTABLE';
    end if;
  end if;
  if avatar is not null and (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url) then
    if avatar like (new.user_id::text || '/%') then
      path := avatar;
    elsif avatar like ('https://lwxrorxqikwlrbaxoygv.supabase.co/storage/v1/object/public/avatars/' || new.user_id::text || '/%')
      or avatar like ('https://lwxrorxqikwlrbaxoygv.supabase.co/storage/v1/object/sign/avatars/' || new.user_id::text || '/%') then
      path := split_part(avatar, '?', 1);
    else
      raise exception 'INVALID_AVATAR_ORIGIN';
    end if;
    if path ~* '%(2e|2f|5c|25)' or path ~ '(^|/)\.\.?(/|$)' or position(chr(92) in path) > 0 then
      raise exception 'INVALID_AVATAR_PATH';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_profile_privilege_boundary() from public, anon, authenticated;
drop trigger if exists enforce_profile_privilege_boundary on public.profiles;
create trigger enforce_profile_privilege_boundary before insert or update on public.profiles
for each row execute function public.enforce_profile_privilege_boundary();

-- Restrictive policies also constrain accidentally permissive legacy policies.
drop policy if exists profiles_read_boundary on public.profiles;
create policy profiles_read_boundary on public.profiles as restrictive for select to authenticated
using (user_id = auth.uid() or public.is_owner());
drop policy if exists profiles_insert_boundary on public.profiles;
create policy profiles_insert_boundary on public.profiles as restrictive for insert to authenticated
with check (user_id = auth.uid() and coalesce(role, 'user') = 'user');
drop policy if exists profiles_update_boundary on public.profiles;
create policy profiles_update_boundary on public.profiles as restrictive for update to authenticated
using (user_id = auth.uid() or public.is_owner())
with check (user_id = auth.uid() or public.is_owner());

-- Editors need business fields for their own department, never PIN hashes/salts.
create or replace function public.list_managed_department_members(p_department_key text)
returns table (
  user_id uuid, role text, oklad numeric, gender text, "position" text,
  display_name text, avatar_url text, hide_money boolean, created_at timestamptz,
  tab_number text, branch text, employment_date date, weekly_hours numeric, sort_order integer
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not coalesce(public.can_edit_department(p_department_key), false) then
    raise exception 'ACCESS_DENIED';
  end if;
  return query select
    p.user_id, p.role, p.oklad, p.gender, p.position, p.display_name,
    p.avatar_url, p.hide_money, p.created_at, p.tab_number, p.branch,
    p.employment_date, p.weekly_hours, member.sort_order
  from public.department_members member join public.profiles p on p.user_id = member.user_id
  where member.department_key = p_department_key
  order by member.sort_order asc nulls last, member.created_at, member.user_id;
end;
$$;
revoke all on function public.list_managed_department_members(text) from public, anon;
grant execute on function public.list_managed_department_members(text) to authenticated;

-- Legacy editor management RPCs used department edit access to delegate rights.
-- Privilege changes are reserved to the owner, including direct table writes.
revoke insert, update, delete on public.department_editors from public, anon, authenticated;
do $$
declare field record;
begin
  for field in select attname from pg_attribute
    where attrelid = 'public.department_editors'::regclass and attnum > 0 and not attisdropped
  loop
    execute format('revoke insert (%I), update (%I) on public.department_editors from public, anon, authenticated', field.attname, field.attname);
  end loop;
end $$;

create or replace function public.owner_add_department_editor(p_department_key text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not coalesce(public.is_owner(), false) then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_user_id is null then raise exception 'USER_ID_REQUIRED'; end if;
  insert into public.department_editors (department_key, user_id)
  values (p_department_key, p_user_id) on conflict do nothing;
end;
$$;
create or replace function public.owner_remove_department_editor(p_department_key text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not coalesce(public.is_owner(), false) then
    raise exception 'ACCESS_DENIED';
  end if;
  delete from public.department_editors
  where department_key = p_department_key and user_id = p_user_id;
end;
$$;
revoke all on function public.owner_add_department_editor(text, uuid) from public, anon;
revoke all on function public.owner_remove_department_editor(text, uuid) from public, anon;
grant execute on function public.owner_add_department_editor(text, uuid) to authenticated;
grant execute on function public.owner_remove_department_editor(text, uuid) to authenticated;

-- Keep the old member endpoint from bypassing protected-member checks for editors.
create or replace function public.owner_remove_department_member(p_department_key text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not coalesce(public.can_edit_department(p_department_key), false) then
    raise exception 'ACCESS_DENIED';
  end if;
  if not coalesce(public.is_owner(), false) then
    perform public.remove_managed_department_member(p_department_key, p_user_id);
    return;
  end if;
  delete from public.department_members where department_key = p_department_key and user_id = p_user_id;
end;
$$;
revoke all on function public.owner_remove_department_member(text, uuid) from public, anon;
grant execute on function public.owner_remove_department_member(text, uuid) to authenticated;

-- Internal helpers accept an actor UUID and must never be callable by clients.
do $$
declare
  routine record;
  department_scoped boolean;
begin
  for routine in
    select p.oid::regprocedure as signature, p.proname, p.prosecdef, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and (p.proname like 'owner\_%' escape '\' or p.proname like '\_owner\_%' escape '\' or p.proname like 'service\_owner\_%' escape '\')
  loop
    execute format('revoke all on function %s from public, anon', routine.signature);
    if routine.proname like '\_owner\_%' escape '\' or routine.proname like 'service\_owner\_%' escape '\' then
      execute format('revoke all on function %s from authenticated', routine.signature);
      execute format('grant execute on function %s to service_role', routine.signature);
    else
      -- These legacy owner_* names also serve editors, scoped to one department.
      department_scoped := coalesce(routine.signature = any(array[
        to_regprocedure('public.owner_create_department_invite(text,integer,integer)'),
        to_regprocedure('public.owner_revoke_department_invite(text)'),
        to_regprocedure('public.owner_delete_department_invite(text)'),
        to_regprocedure('public.owner_list_department_members(text)'),
        to_regprocedure('public.owner_list_available_profiles(text)'),
        to_regprocedure('public.owner_list_department_editors(text)'),
        to_regprocedure('public.owner_add_department_member(text,uuid)'),
        to_regprocedure('public.owner_remove_department_member(text,uuid)')
      ]), false);
      if not routine.prosecdef or (
        routine.definition !~ 'is_owner\s*\('
        and not (department_scoped and routine.definition ~ 'can_edit_department\s*\(')
      ) then
        raise exception 'REVIEW_OWNER_FUNCTION: %', routine.signature;
      end if;
      -- Invite creation resolves pgcrypto.gen_random_bytes in extensions.
      execute format('alter function %s set search_path = public, extensions, pg_temp', routine.signature);
    end if;
  end loop;
end $$;

commit;
