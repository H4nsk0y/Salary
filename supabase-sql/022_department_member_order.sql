alter table public.department_members
add column if not exists sort_order integer;

comment on column public.department_members.sort_order is 'Ручной порядок сотрудников внутри отдела для общего табеля.';

create index if not exists department_members_department_sort_idx
on public.department_members (department_key, sort_order, created_at);

with ranked as (
  select
    dm.department_key,
    dm.user_id,
    row_number() over (
      partition by dm.department_key
      order by dm.created_at asc, dm.user_id asc
    ) as rn
  from public.department_members dm
)
update public.department_members dm
set sort_order = ranked.rn * 10
from ranked
where dm.department_key = ranked.department_key
  and dm.user_id = ranked.user_id
  and dm.sort_order is null;

create or replace function public.set_department_member_order(
  p_department_key text,
  p_user_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
  v_total integer;
  v_requested integer;
  v_unique integer;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_department_key is null then
    raise exception 'DEPARTMENT_REQUIRED';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  if p_user_ids is null then
    raise exception 'USER_IDS_REQUIRED';
  end if;

  select count(*)::integer
  into v_total
  from public.department_members dm
  where dm.department_key = v_department_key;

  select count(*)::integer, count(distinct user_id)::integer
  into v_requested, v_unique
  from unnest(p_user_ids) as requested(user_id)
  where requested.user_id is not null;

  if v_requested <> v_unique then
    raise exception 'DUPLICATE_USER_IDS';
  end if;

  if v_requested <> v_total then
    raise exception 'MEMBER_ORDER_MISMATCH';
  end if;

  if exists (
    select 1
    from unnest(p_user_ids) as requested(user_id)
    left join public.department_members dm
      on dm.department_key = v_department_key
     and dm.user_id = requested.user_id
    where requested.user_id is null
       or dm.user_id is null
  ) then
    raise exception 'MEMBER_ORDER_MISMATCH';
  end if;

  update public.department_members dm
  set sort_order = ordered.ord * 10
  from (
    select
      requested.user_id,
      requested.ordinality::integer as ord
    from unnest(p_user_ids) with ordinality as requested(user_id, ordinality)
  ) ordered
  where dm.department_key = v_department_key
    and dm.user_id = ordered.user_id;
end;
$$;

revoke all on function public.set_department_member_order(text, uuid[]) from public;
grant execute on function public.set_department_member_order(text, uuid[]) to authenticated;

create or replace function public.owner_list_department_members(p_department_key text)
returns table (
  user_id uuid,
  display_name text,
  position_name text,
  tab_number text,
  role text,
  created_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if not public.can_edit_department(p_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  return query
  select
    m.user_id,
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.position), ''), 'Сотрудник') as display_name,
    coalesce(p.position, '') as position_name,
    coalesce(p.tab_number, '') as tab_number,
    coalesce(p.role, 'user') as role,
    m.created_at
  from public.department_members m
  left join public.profiles p on p.user_id = m.user_id
  where m.department_key = p_department_key
  order by
    coalesce(m.sort_order, 2147483647),
    m.created_at,
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.position), ''), m.user_id::text);
end;
$$;

revoke all on function public.owner_list_department_members(text) from public;
grant execute on function public.owner_list_department_members(text) to authenticated;
