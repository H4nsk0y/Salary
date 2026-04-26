create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now(),
  page text,
  updated_at timestamptz not null default now()
);

alter table public.user_presence enable row level security;

create index if not exists user_presence_last_seen_idx
on public.user_presence (last_seen desc);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_presence'
      and policyname = 'user_presence_select_own'
  ) then
    create policy "user_presence_select_own"
    on public.user_presence for select to authenticated
    using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_presence'
      and policyname = 'user_presence_insert_own'
  ) then
    create policy "user_presence_insert_own"
    on public.user_presence for insert to authenticated
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_presence'
      and policyname = 'user_presence_update_own'
  ) then
    create policy "user_presence_update_own"
    on public.user_presence for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, update on public.user_presence to authenticated;

create or replace function public.owner_list_online_users(p_department_key text default null)
returns table (
  user_id uuid,
  display_name text,
  "position" text,
  tab_number text,
  role text,
  avatar_url text,
  department_key text,
  department_name text,
  page text,
  last_seen timestamptz,
  seconds_ago integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
begin
  if not public.is_owner() then
    raise exception 'Only owner can view online users';
  end if;

  return query
  select
    up.user_id,
    p.display_name,
    p.position as "position",
    p.tab_number,
    p.role,
    p.avatar_url,
    dept.department_key,
    dept.department_name,
    up.page,
    up.last_seen,
    greatest(0, floor(extract(epoch from (now() - up.last_seen))))::integer
  from public.user_presence up
  left join public.profiles p on p.user_id = up.user_id
  left join lateral (
    select x.department_key, d.name as department_name
    from (
      select dm.department_key, dm.created_at, 1 as sort_order
      from public.department_members dm
      where dm.user_id = up.user_id

      union all

      select de.department_key, de.created_at, 2 as sort_order
      from public.department_editors de
      where de.user_id = up.user_id
    ) x
    left join public.departments d on d.key = x.department_key
    order by x.sort_order, x.created_at asc
    limit 1
  ) dept on true
  where up.last_seen > now() - interval '2 minutes'
    and (
      v_department_key is null
      or exists (
        select 1 from public.department_members dm_filter
        where dm_filter.user_id = up.user_id
          and dm_filter.department_key = v_department_key
      )
      or exists (
        select 1 from public.department_editors de_filter
        where de_filter.user_id = up.user_id
          and de_filter.department_key = v_department_key
      )
    )
  order by up.last_seen desc;
end;
$$;

revoke all on function public.owner_list_online_users(text) from public;
grant execute on function public.owner_list_online_users(text) to authenticated;

