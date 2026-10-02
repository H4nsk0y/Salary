-- Owner-managed position locks. The database trigger prevents bypassing the UI
-- with a direct profiles update while allowing the owner to edit user profiles.

create table if not exists public.user_profile_restrictions (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  position_locked boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.user_profile_restrictions enable row level security;
revoke all on table public.user_profile_restrictions from public, anon, authenticated;

create or replace function public.owner_set_user_position_lock(
  p_user_id uuid,
  p_locked boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position text;
  v_role text;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;

  select nullif(btrim(p.position), ''), coalesce(p.role, 'user')
  into v_position, v_role
  from public.profiles p
  where p.user_id = p_user_id;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_role = 'owner' then
    raise exception 'CANNOT_LOCK_OWNER';
  end if;
  if coalesce(p_locked, false) and v_position is null then
    raise exception 'POSITION_REQUIRED';
  end if;

  if coalesce(p_locked, false) then
    insert into public.user_profile_restrictions (user_id, position_locked, updated_at, updated_by)
    values (p_user_id, true, now(), auth.uid())
    on conflict (user_id) do update
      set position_locked = true,
          updated_at = now(),
          updated_by = auth.uid();
  else
    delete from public.user_profile_restrictions where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.owner_list_user_position_locks()
returns table (user_id uuid, position_locked boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;

  return query
    select restriction.user_id, restriction.position_locked
    from public.user_profile_restrictions restriction
    where restriction.position_locked;
end;
$$;

create or replace function public.enforce_profile_position_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.position is distinct from old.position
    and exists (
      select 1
      from public.user_profile_restrictions restriction
      where restriction.user_id = old.user_id
        and restriction.position_locked
    )
    and auth.uid() is not null
    and not public.is_owner()
  then
    raise exception 'POSITION_CHANGE_LOCKED';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_profile_position_lock_trigger on public.profiles;
create trigger enforce_profile_position_lock_trigger
before update of position on public.profiles
for each row execute function public.enforce_profile_position_lock();

create or replace function public.get_my_app_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'NO_SESSION';
  end if;

  return (
    with member_access as (
      select dm.department_key
      from public.department_members dm
      where dm.user_id = v_user_id
      order by dm.department_key
      limit 1
    ), editor_access as (
      select de.department_key
      from public.department_editors de
      where de.user_id = v_user_id
      order by de.department_key
      limit 1
    )
    select jsonb_build_object(
      'profile', (
        select jsonb_build_object(
          'user_id', p.user_id,
          'role', p.role,
          'oklad', p.oklad,
          'gender', p.gender,
          'position', p.position,
          'position_locked', exists (
            select 1
            from public.user_profile_restrictions restriction
            where restriction.user_id = p.user_id
              and restriction.position_locked
          ),
          'display_name', p.display_name,
          'avatar_url', p.avatar_url,
          'hide_money', p.hide_money,
          'money_pin_hash', p.money_pin_hash,
          'money_pin_salt', p.money_pin_salt,
          'auto_collapse_table_panels', p.auto_collapse_table_panels,
          'tab_number', p.tab_number,
          'branch', p.branch,
          'employment_date', p.employment_date,
          'weekly_hours', p.weekly_hours,
          'egais_file_reminders_enabled', p.egais_file_reminders_enabled,
          'hide_calculator_nav', p.hide_calculator_nav
        )
        from public.profiles p
        where p.user_id = v_user_id
      ),
      'membership_department_key', (
        select ma.department_key from member_access ma
      ),
      'editor_department_key', (
        select ea.department_key from editor_access ea
      ),
      'managed_department', (
        select jsonb_build_object(
          'key', ea.department_key,
          'name', coalesce(d.name, ea.department_key)
        )
        from editor_access ea
        left join public.departments d on d.key = ea.department_key
      )
    )
  );
end;
$$;

revoke all on function public.owner_set_user_position_lock(uuid, boolean) from public, anon;
revoke all on function public.owner_list_user_position_locks() from public, anon;
revoke all on function public.enforce_profile_position_lock() from public, anon, authenticated;
revoke all on function public.get_my_app_context() from public, anon;
grant execute on function public.owner_set_user_position_lock(uuid, boolean) to authenticated;
grant execute on function public.owner_list_user_position_locks() to authenticated;
grant execute on function public.get_my_app_context() to authenticated;

comment on table public.user_profile_restrictions is
  'Owner-managed restrictions that ordinary users cannot bypass through direct profile updates.';
