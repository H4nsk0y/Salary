-- Run in Supabase SQL Editor before using owner leader controls.
begin;

alter table public.department_editors
  add column if not exists is_leader boolean not null default false,
  add column if not exists is_manual_editor boolean not null default true;

create unique index if not exists department_editors_one_leader_idx
  on public.department_editors (department_key) where is_leader;
create unique index if not exists department_editors_one_leadership_per_user_idx
  on public.department_editors (user_id) where is_leader;

revoke insert, update, delete on public.department_editors from authenticated;

create or replace function public.owner_set_department_leader(
  p_department_key text, p_user_id uuid, p_is_leader boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := nullif(btrim(p_department_key), '');
  v_current uuid;
begin
  if auth.uid() is null or not public.is_owner() then raise exception 'ACCESS_DENIED'; end if;
  if v_key is null or p_user_id is null then raise exception 'DEPARTMENT_AND_USER_REQUIRED'; end if;
  if not exists (select 1 from public.department_members
                 where department_key = v_key and user_id = p_user_id) then
    raise exception 'USER_NOT_IN_DEPARTMENT';
  end if;

  select user_id into v_current from public.department_editors
  where department_key = v_key and is_leader for update;

  if coalesce(p_is_leader, false) then
    if v_current is not null and v_current <> p_user_id then
      raise exception 'DEPARTMENT_LEADER_ALREADY_ASSIGNED';
    end if;
    insert into public.department_editors (department_key, user_id, is_leader, is_manual_editor)
    values (v_key, p_user_id, true, false)
    on conflict do nothing;
    update public.department_editors set is_leader = true
    where department_key = v_key and user_id = p_user_id;
    if not found then raise exception 'DEPARTMENT_LEADER_ASSIGNMENT_FAILED'; end if;
  else
    if v_current is distinct from p_user_id then return; end if;
    delete from public.department_editors
    where department_key = v_key and user_id = p_user_id and not is_manual_editor;
    update public.department_editors set is_leader = false
    where department_key = v_key and user_id = p_user_id and is_manual_editor;
  end if;

  if (v_current = p_user_id) is distinct from coalesce(p_is_leader, false) then
    perform public._owner_write_audit(auth.uid(), p_user_id,
      case when p_is_leader then 'leader_granted' else 'leader_revoked' end,
      jsonb_build_object('department_key', v_key));
  end if;
end;
$$;

create or replace function public.owner_set_department_editor(
  p_department_key text, p_user_id uuid, p_is_editor boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := nullif(btrim(p_department_key), '');
  v_was_editor boolean;
begin
  if auth.uid() is null or not public.is_owner() then raise exception 'ACCESS_DENIED'; end if;
  if v_key is null or p_user_id is null then raise exception 'DEPARTMENT_AND_USER_REQUIRED'; end if;
  if not exists (select 1 from public.department_members
                 where department_key = v_key and user_id = p_user_id) then
    raise exception 'USER_NOT_IN_DEPARTMENT';
  end if;

  select coalesce((select is_manual_editor from public.department_editors
                   where department_key = v_key and user_id = p_user_id), false)
  into v_was_editor;
  if p_is_editor then
    insert into public.department_editors (department_key, user_id, is_manual_editor)
    values (v_key, p_user_id, true)
    on conflict do nothing;
    update public.department_editors set is_manual_editor = true
    where department_key = v_key and user_id = p_user_id;
  else
    delete from public.department_editors
    where department_key = v_key and user_id = p_user_id and not is_leader;
    update public.department_editors set is_manual_editor = false
    where department_key = v_key and user_id = p_user_id and is_leader;
  end if;

  if v_was_editor is distinct from coalesce(p_is_editor, false) then
    perform public._owner_write_audit(auth.uid(), p_user_id,
      case when p_is_editor then 'editor_granted' else 'editor_revoked' end,
      jsonb_build_object('department_key', v_key));
  end if;
end;
$$;

create or replace function public.owner_list_department_leaders()
returns table (department_key text, user_id uuid, is_manual_editor boolean)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_owner() then raise exception 'ACCESS_DENIED'; end if;
  return query select de.department_key, de.user_id, de.is_manual_editor
    from public.department_editors de where de.is_leader;
end;
$$;

create or replace function public.list_department_leader(p_department_key text)
returns table (user_id uuid)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_edit_department(p_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;
  return query select de.user_id from public.department_editors de
    where de.department_key = p_department_key and de.is_leader;
end;
$$;

create or replace function public.list_reserved_leader_positions()
returns table ("position" text)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  return query select distinct p.position from public.department_editors de
    join public.profiles p on p.user_id = de.user_id
    where de.is_leader and de.user_id <> auth.uid() and p.position is not null
      and (p.position ~ '(^|_)head$' or p.position in ('chief_accountant', 'director'));
end;
$$;

create or replace function public.protect_leader_position()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_position text := nullif(btrim(new.position), '');
begin
  if v_position is not null and (
    v_position ~ '(^|_)head$' or v_position in ('chief_accountant', 'director')
  ) and exists (
    select 1 from public.department_editors de
    join public.profiles p on p.user_id = de.user_id
    where de.is_leader and p.user_id <> new.user_id and p.position = v_position
  ) then
    raise exception 'DEPARTMENT_LEADER_POSITION_RESERVED';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_protect_leader_position'
    and tgrelid = 'public.profiles'::regclass and not tgisinternal) then
    create trigger trg_protect_leader_position
      before insert or update of position on public.profiles
      for each row execute function public.protect_leader_position();
  end if;
end;
$$;

revoke all on function public.owner_set_department_leader(text, uuid, boolean) from public, anon;
revoke all on function public.owner_set_department_editor(text, uuid, boolean) from public, anon;
revoke all on function public.owner_list_department_leaders() from public, anon;
revoke all on function public.list_department_leader(text) from public, anon;
revoke all on function public.list_reserved_leader_positions() from public, anon;
revoke all on function public.protect_leader_position() from public, anon, authenticated;
grant execute on function public.owner_set_department_leader(text, uuid, boolean) to authenticated;
grant execute on function public.owner_set_department_editor(text, uuid, boolean) to authenticated;
grant execute on function public.owner_list_department_leaders() to authenticated;
grant execute on function public.list_department_leader(text) to authenticated;
grant execute on function public.list_reserved_leader_positions() to authenticated;

commit;
