create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.department_invites (
  id uuid primary key default gen_random_uuid(),
  department_key text not null references public.departments(key) on delete cascade,
  token text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses integer,
  used_count integer not null default 0,
  revoked_at timestamptz,
  constraint department_invites_token_len check (char_length(token) between 24 and 120),
  constraint department_invites_max_uses_check check (max_uses is null or max_uses > 0),
  constraint department_invites_used_count_check check (used_count >= 0)
);

create index if not exists department_invites_department_key_idx
on public.department_invites (department_key);

create index if not exists department_invites_active_idx
on public.department_invites (created_at desc)
where revoked_at is null;

alter table public.department_invites enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'department_invites'
      and policyname = 'department_invites_owner_select'
  ) then
    create policy "department_invites_owner_select"
    on public.department_invites
    for select
    to authenticated
    using (public.is_owner());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'department_invites'
      and policyname = 'department_invites_editor_select'
  ) then
    create policy "department_invites_editor_select"
    on public.department_invites
    for select
    to authenticated
    using (public.can_edit_department(department_key));
  end if;
end $$;

create or replace function public.list_department_shift_overview(
  p_department_key text default null,
  p_start_date date default current_date,
  p_days integer default 2
)
returns table (
  department_key text,
  department_name text,
  target_date date,
  day_index integer,
  user_id uuid,
  display_name text,
  position_name text,
  tab_number text,
  avatar_url text,
  day_hours numeric,
  night_hours numeric,
  leave_type text,
  has_timesheet boolean,
  shift_status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
  v_start_date date := coalesce(p_start_date, current_date);
  v_days integer := greatest(1, least(coalesce(p_days, 2), 7));
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_department_key is null then
    select dm.department_key
    into v_department_key
    from public.department_members dm
    where dm.user_id = auth.uid()
    order by dm.created_at asc
    limit 1;
  end if;

  if v_department_key is null then
    select de.department_key
    into v_department_key
    from public.department_editors de
    where de.user_id = auth.uid()
    order by de.created_at asc
    limit 1;
  end if;

  if v_department_key is null then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  if not exists (select 1 from public.departments d where d.key = v_department_key) then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  if not (
    public.is_owner()
    or exists (
      select 1
      from public.department_members dm
      where dm.department_key = v_department_key
        and dm.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.department_editors de
      where de.department_key = v_department_key
        and de.user_id = auth.uid()
    )
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  return query
  with target_dates as (
    select
      (v_start_date + gs.day_offset)::date as target_date,
      (extract(day from (v_start_date + gs.day_offset)::date)::integer - 1) as day_index,
      extract(year from (v_start_date + gs.day_offset)::date)::integer as target_year,
      (extract(month from (v_start_date + gs.day_offset)::date)::integer - 1) as target_month
    from generate_series(0, v_days - 1) as gs(day_offset)
  ),
  members as (
    select
      dm.department_key,
      dm.user_id,
      dm.created_at,
      p.display_name,
      p.position,
      p.tab_number,
      p.avatar_url
    from public.department_members dm
    left join public.profiles p on p.user_id = dm.user_id
    where dm.department_key = v_department_key
  )
  select
    m.department_key,
    d.name as department_name,
    td.target_date,
    td.day_index,
    m.user_id,
    coalesce(nullif(btrim(m.display_name), ''), nullif(btrim(m.position), ''), 'Сотрудник') as display_name,
    coalesce(m.position, '') as position_name,
    coalesce(m.tab_number, '') as tab_number,
    m.avatar_url,
    parsed.day_hours,
    parsed.night_hours,
    parsed.leave_type,
    (t.payload is not null) as has_timesheet,
    case
      when parsed.leave_type is not null then 'leave'
      when (parsed.day_hours + parsed.night_hours) > 0 then 'work'
      when t.payload is not null then 'off'
      else 'not_filled'
    end as shift_status
  from target_dates td
  cross join members m
  join public.departments d on d.key = m.department_key
  left join public.timesheets t
    on t.user_id = m.user_id
   and t.year = td.target_year
   and t.month = td.target_month
  left join lateral (
    select
      t.payload -> 'dayHours' ->> td.day_index as day_raw,
      t.payload -> 'nightHours' ->> td.day_index as night_raw,
      t.payload -> 'leaveType' ->> td.day_index as leave_raw
  ) raw on true
  left join lateral (
    select
      case
        when raw.day_raw ~ '^-?[0-9]+([.][0-9]+)?$' then raw.day_raw::numeric
        else 0::numeric
      end as day_hours,
      case
        when raw.night_raw ~ '^-?[0-9]+([.][0-9]+)?$' then raw.night_raw::numeric
        else 0::numeric
      end as night_hours,
      nullif(btrim(raw.leave_raw), '') as leave_type
  ) parsed on true
  order by
    td.target_date,
    case
      when (parsed.day_hours + parsed.night_hours) > 0 then 0
      when parsed.leave_type is not null then 1
      when t.payload is not null then 2
      else 3
    end,
    coalesce(nullif(btrim(m.display_name), ''), nullif(btrim(m.position), ''), m.user_id::text);
end;
$$;

create or replace function public.owner_create_department_invite(
  p_department_key text,
  p_expires_in_days integer default 14,
  p_max_uses integer default null
)
returns table (
  token text,
  department_key text,
  department_name text,
  expires_at timestamptz,
  max_uses integer,
  used_count integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
  v_token text;
  v_expires_days integer := greatest(1, least(coalesce(p_expires_in_days, 14), 90));
  v_max_uses integer := case when coalesce(p_max_uses, 0) > 0 then least(p_max_uses, 500) else null end;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_department_key is null then
    raise exception 'DEPARTMENT_REQUIRED';
  end if;

  if not exists (select 1 from public.departments d where d.key = v_department_key) then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into public.department_invites (
    department_key,
    token,
    created_by,
    expires_at,
    max_uses
  )
  values (
    v_department_key,
    v_token,
    auth.uid(),
    now() + make_interval(days => v_expires_days),
    v_max_uses
  );

  return query
  select
    i.token,
    i.department_key,
    d.name as department_name,
    i.expires_at,
    i.max_uses,
    i.used_count,
    i.created_at
  from public.department_invites i
  join public.departments d on d.key = i.department_key
  where i.token = v_token;
end;
$$;

create or replace function public.owner_list_department_invites()
returns table (
  token text,
  department_key text,
  department_name text,
  created_at timestamptz,
  expires_at timestamptz,
  max_uses integer,
  used_count integer,
  revoked_at timestamptz,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  return query
  select
    i.token,
    i.department_key,
    d.name as department_name,
    i.created_at,
    i.expires_at,
    i.max_uses,
    i.used_count,
    i.revoked_at,
    (
      i.revoked_at is null
      and (i.expires_at is null or i.expires_at > now())
      and (i.max_uses is null or i.used_count < i.max_uses)
    ) as is_active
  from public.department_invites i
  join public.departments d on d.key = i.department_key
  where public.is_owner()
     or public.can_edit_department(i.department_key)
  order by
    (
      i.revoked_at is null
      and (i.expires_at is null or i.expires_at > now())
      and (i.max_uses is null or i.used_count < i.max_uses)
    ) desc,
    i.created_at desc
  limit 50;
end;
$$;

create or replace function public.owner_revoke_department_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(p_token), '');
  v_department_key text;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_token is null then
    raise exception 'INVITE_TOKEN_REQUIRED';
  end if;

  select i.department_key
  into v_department_key
  from public.department_invites i
  where i.token = v_token;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  update public.department_invites
  set revoked_at = coalesce(revoked_at, now())
  where token = v_token;
end;
$$;

create or replace function public.accept_department_invite(p_token text)
returns table (
  department_key text,
  department_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(p_token), '');
  v_invite record;
  v_user_id uuid := auth.uid();
  v_inserted_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'NO_SESSION';
  end if;

  if v_token is null then
    raise exception 'INVITE_TOKEN_REQUIRED';
  end if;

  select
    i.*,
    d.name as department_name
  into v_invite
  from public.department_invites i
  join public.departments d on d.key = i.department_key
  where i.token = v_token
  for update of i;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'INVITE_REVOKED';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'INVITE_EXPIRED';
  end if;

  if v_invite.max_uses is not null and v_invite.used_count >= v_invite.max_uses then
    raise exception 'INVITE_USED_UP';
  end if;

  insert into public.profiles (user_id, role)
  values (v_user_id, 'user')
  on conflict (user_id) do nothing;

  if exists (
    select 1
    from public.department_members dm
    where dm.user_id = v_user_id
      and dm.department_key <> v_invite.department_key
  ) then
    raise exception 'USER_ALREADY_IN_ANOTHER_DEPARTMENT';
  end if;

  insert into public.department_members (department_key, user_id)
  values (v_invite.department_key, v_user_id)
  on conflict do nothing;

  get diagnostics v_inserted_count = row_count;

  if v_inserted_count > 0 then
    update public.department_invites
    set used_count = used_count + 1
    where token = v_token;
  end if;

  return query
  select v_invite.department_key::text, v_invite.department_name::text;
end;
$$;

revoke all on function public.list_department_shift_overview(text, date, integer) from public;
revoke all on function public.owner_create_department_invite(text, integer, integer) from public;
revoke all on function public.owner_list_department_invites() from public;
revoke all on function public.owner_revoke_department_invite(text) from public;
revoke all on function public.accept_department_invite(text) from public;

grant execute on function public.list_department_shift_overview(text, date, integer) to authenticated;
grant execute on function public.owner_create_department_invite(text, integer, integer) to authenticated;
grant execute on function public.owner_list_department_invites() to authenticated;
grant execute on function public.owner_revoke_department_invite(text) to authenticated;
grant execute on function public.accept_department_invite(text) to authenticated;
