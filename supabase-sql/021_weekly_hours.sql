alter table public.profiles
add column if not exists weekly_hours numeric;

comment on column public.profiles.weekly_hours is 'Норма часов в неделю для расчета табеля. NULL/40 = стандартная норма, 35 = сокращенная 35-часовая неделя.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_weekly_hours_check'
  ) then
    alter table public.profiles
    add constraint profiles_weekly_hours_check
    check (weekly_hours is null or weekly_hours in (35, 40));
  end if;
end $$;

create index if not exists profiles_weekly_hours_idx
on public.profiles (weekly_hours);

create or replace function public.owner_list_users_v3()
returns table (
  user_id uuid,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  display_name text,
  "position" text,
  gender text,
  tab_number text,
  role text,
  avatar_url text,
  oklad numeric,
  branch text,
  employment_date date,
  weekly_hours numeric,
  hide_money boolean,
  egais_file_reminders_enabled boolean,
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
  missing_fields text[],
  push_enabled boolean,
  timesheet_count integer,
  active_session_count integer
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
    au.email::text,
    au.email_confirmed_at,
    au.last_sign_in_at,
    au.banned_until,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.position), ''), 'Сотрудник') as display_name,
    coalesce(p.position, '') as "position",
    coalesce(p.gender, '') as gender,
    coalesce(p.tab_number, '') as tab_number,
    coalesce(p.role, 'user') as role,
    p.avatar_url,
    p.oklad,
    coalesce(p.branch, '') as branch,
    p.employment_date,
    p.weekly_hours,
    coalesce(p.hide_money, false) as hide_money,
    coalesce(p.egais_file_reminders_enabled, false) as egais_file_reminders_enabled,
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
    ], null::text) as missing_fields,
    exists (
      select 1
      from public.push_subscriptions ps
      where ps.user_id = p.user_id
        and ps.enabled = true
    ) as push_enabled,
    (
      select count(*)::integer
      from public.timesheets t
      where t.user_id = p.user_id
    ) as timesheet_count,
    (
      select count(*)::integer
      from auth.sessions s
      where s.user_id = p.user_id
    ) as active_session_count
  from public.profiles p
  join auth.users au on au.id = p.user_id
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

create or replace function public.owner_update_user_profile_v2(
  p_user_id uuid,
  p_display_name text,
  p_position text,
  p_gender text,
  p_tab_number text,
  p_branch text,
  p_employment_date date,
  p_weekly_hours numeric,
  p_oklad numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before record;
  v_after record;
  v_display_name text := nullif(btrim(p_display_name), '');
  v_position text := nullif(btrim(p_position), '');
  v_gender text := nullif(btrim(p_gender), '');
  v_tab_number text := nullif(btrim(p_tab_number), '');
  v_branch text := nullif(btrim(p_branch), '');
  v_weekly_hours numeric := case
    when p_weekly_hours = 35 then 35
    when p_weekly_hours = 40 then 40
    else null
  end;
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

  if v_gender is not null and v_gender not in ('male', 'female') then
    raise exception 'INVALID_GENDER';
  end if;

  if v_branch is not null and v_branch not in (
    'chateau_alvisa',
    'alvisa_whisky',
    'alvisa_beverage',
    'alvisa_whisky_distillery',
    'kin_wine_cognac_factory'
  ) then
    raise exception 'INVALID_BRANCH';
  end if;

  if p_weekly_hours is not null and p_weekly_hours not in (35, 40) then
    raise exception 'INVALID_WEEKLY_HOURS';
  end if;

  if p_oklad is not null and p_oklad < 0 then
    raise exception 'INVALID_OKLAD';
  end if;

  select
    p.display_name,
    p.position,
    p.gender,
    p.tab_number,
    p.branch,
    p.employment_date,
    p.weekly_hours,
    p.oklad
  into v_before
  from public.profiles p
  where p.user_id = p_user_id;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  update public.profiles
  set
    display_name = v_display_name,
    position = v_position,
    gender = v_gender,
    tab_number = v_tab_number,
    branch = v_branch,
    employment_date = p_employment_date,
    weekly_hours = v_weekly_hours,
    oklad = p_oklad
  where user_id = p_user_id;

  select
    p.display_name,
    p.position,
    p.gender,
    p.tab_number,
    p.branch,
    p.employment_date,
    p.weekly_hours,
    p.oklad
  into v_after
  from public.profiles p
  where p.user_id = p_user_id;

  perform public._owner_write_audit(
    auth.uid(),
    p_user_id,
    'profile_updated',
    jsonb_build_object(
      'before', jsonb_build_object(
        'display_name', v_before.display_name,
        'position', v_before.position,
        'gender', v_before.gender,
        'tab_number', v_before.tab_number,
        'branch', v_before.branch,
        'employment_date', v_before.employment_date,
        'weekly_hours', v_before.weekly_hours,
        'oklad', v_before.oklad
      ),
      'after', jsonb_build_object(
        'display_name', v_after.display_name,
        'position', v_after.position,
        'gender', v_after.gender,
        'tab_number', v_after.tab_number,
        'branch', v_after.branch,
        'employment_date', v_after.employment_date,
        'weekly_hours', v_after.weekly_hours,
        'oklad', v_after.oklad
      )
    )
  );
end;
$$;

revoke all on function public.owner_list_users_v3() from public;
revoke all on function public.owner_update_user_profile_v2(uuid, text, text, text, text, text, date, numeric, numeric) from public;

grant execute on function public.owner_list_users_v3() to authenticated;
grant execute on function public.owner_update_user_profile_v2(uuid, text, text, text, text, text, date, numeric, numeric) to authenticated;
