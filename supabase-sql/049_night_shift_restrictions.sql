-- Owner-managed temporary restrictions for employees who must not be assigned
-- to night shifts. Ordinary users cannot read or change these flags directly.

create table if not exists public.user_schedule_constraints (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  no_night_shifts boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.user_schedule_constraints enable row level security;
revoke all on table public.user_schedule_constraints from public, anon, authenticated;

create or replace function public.owner_set_user_night_shift_restriction(
  p_user_id uuid,
  p_forbidden boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_user_id is null or not exists (
    select 1 from public.profiles p where p.user_id = p_user_id
  ) then
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into public.user_schedule_constraints (user_id, no_night_shifts, updated_at, updated_by)
  values (p_user_id, coalesce(p_forbidden, false), now(), auth.uid())
  on conflict (user_id) do update
    set no_night_shifts = excluded.no_night_shifts,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
end;
$$;

create or replace function public.owner_list_user_night_shift_restrictions()
returns table (user_id uuid, no_night_shifts boolean)
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
    select c.user_id, c.no_night_shifts
    from public.user_schedule_constraints c
    where c.no_night_shifts;
end;
$$;

create or replace function public.list_managed_department_night_shift_restrictions(
  p_department_key text
)
returns table (user_id uuid, no_night_shifts boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := nullif(btrim(p_department_key), '');
begin
  if v_key is null or auth.uid() is null or not (
    public.is_owner() or public.can_edit_department(v_key)
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  return query
    select c.user_id, c.no_night_shifts
    from public.user_schedule_constraints c
    join public.department_members dm on dm.user_id = c.user_id
    where dm.department_key = v_key and c.no_night_shifts;
end;
$$;

revoke all on function public.owner_set_user_night_shift_restriction(uuid, boolean) from public, anon;
revoke all on function public.owner_list_user_night_shift_restrictions() from public, anon;
revoke all on function public.list_managed_department_night_shift_restrictions(text) from public, anon;
grant execute on function public.owner_set_user_night_shift_restriction(uuid, boolean) to authenticated;
grant execute on function public.owner_list_user_night_shift_restrictions() to authenticated;
grant execute on function public.list_managed_department_night_shift_restrictions(text) to authenticated;
