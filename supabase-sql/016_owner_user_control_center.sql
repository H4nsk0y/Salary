begin;

alter table public.profiles
add column if not exists egais_file_reminders_enabled boolean not null default false;

create table if not exists public.owner_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  target_user_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint owner_audit_log_action_length check (char_length(action) between 2 and 120)
);

create index if not exists owner_audit_log_created_idx
on public.owner_audit_log (created_at desc);

create index if not exists owner_audit_log_target_idx
on public.owner_audit_log (target_user_id, created_at desc);

alter table public.owner_audit_log enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'owner_audit_log'
      and policyname = 'owner_audit_log_select_owner'
  ) then
    create policy "owner_audit_log_select_owner"
    on public.owner_audit_log
    for select
    to authenticated
    using (public.is_owner());
  end if;
end $$;

revoke all on public.owner_audit_log from anon, authenticated;
grant select on public.owner_audit_log to authenticated;

create or replace function public._owner_write_audit(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := nullif(btrim(p_action), '');
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.profiles p
    where p.user_id = p_actor_user_id
      and p.role = 'owner'
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  if v_action is null then
    raise exception 'AUDIT_ACTION_REQUIRED';
  end if;

  insert into public.owner_audit_log (
    actor_user_id,
    target_user_id,
    action,
    details
  )
  values (
    p_actor_user_id,
    p_target_user_id,
    left(v_action, 120),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on function public._owner_write_audit(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public._owner_write_audit(uuid, uuid, text, jsonb) to service_role;

create or replace function public.owner_list_users_v2()
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

create or replace function public.owner_update_user_profile(
  p_user_id uuid,
  p_display_name text,
  p_position text,
  p_gender text,
  p_tab_number text,
  p_branch text,
  p_employment_date date,
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
    oklad = p_oklad
  where user_id = p_user_id;

  select
    p.display_name,
    p.position,
    p.gender,
    p.tab_number,
    p.branch,
    p.employment_date,
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
        'oklad', v_before.oklad
      ),
      'after', jsonb_build_object(
        'display_name', v_after.display_name,
        'position', v_after.position,
        'gender', v_after.gender,
        'tab_number', v_after.tab_number,
        'branch', v_after.branch,
        'employment_date', v_after.employment_date,
        'oklad', v_after.oklad
      )
    )
  );
end;
$$;

create or replace function public.owner_list_user_timesheets(
  p_user_id uuid,
  p_limit integer default 36
)
returns table (
  year integer,
  month integer,
  payload jsonb,
  updated_at timestamptz
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

  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  return query
  select t.year, t.month, t.payload, t.updated_at
  from public.timesheets t
  where t.user_id = p_user_id
  order by t.year desc, t.month desc
  limit least(120, greatest(1, coalesce(p_limit, 36)));
end;
$$;

create or replace function public.owner_list_user_audit(
  p_user_id uuid default null,
  p_limit integer default 100
)
returns table (
  id bigint,
  actor_user_id uuid,
  actor_name text,
  target_user_id uuid,
  target_name text,
  action text,
  details jsonb,
  created_at timestamptz
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
    log.id,
    log.actor_user_id,
    coalesce(nullif(btrim(actor.display_name), ''), actor.position, 'Owner') as actor_name,
    log.target_user_id,
    coalesce(
      nullif(btrim(target.display_name), ''),
      target.position,
      nullif(log.details ->> 'target_name', ''),
      'Сотрудник'
    ) as target_name,
    log.action,
    log.details,
    log.created_at
  from public.owner_audit_log log
  left join public.profiles actor on actor.user_id = log.actor_user_id
  left join public.profiles target on target.user_id = log.target_user_id
  where p_user_id is null or log.target_user_id = p_user_id
  order by log.created_at desc
  limit least(500, greatest(1, coalesce(p_limit, 100)));
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
  v_old_department_key text;
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

  if not exists (select 1 from public.profiles p where p.user_id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;

  if v_department_key is not null and not exists (
    select 1 from public.departments d where d.key = v_department_key
  ) then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  select dm.department_key
  into v_old_department_key
  from public.department_members dm
  where dm.user_id = p_user_id
  order by dm.created_at asc
  limit 1;

  delete from public.department_members where user_id = p_user_id;

  delete from public.department_editors
  where user_id = p_user_id
    and (v_department_key is null or department_key <> v_department_key);

  if v_department_key is not null then
    insert into public.department_members (department_key, user_id)
    values (v_department_key, p_user_id)
    on conflict do nothing;
  end if;

  if v_old_department_key is distinct from v_department_key then
    perform public._owner_write_audit(
      auth.uid(),
      p_user_id,
      'department_changed',
      jsonb_build_object(
        'before', v_old_department_key,
        'after', v_department_key
      )
    );
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
  v_was_editor boolean;
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

  select exists (
    select 1
    from public.department_editors de
    where de.department_key = v_department_key
      and de.user_id = p_user_id
  ) into v_was_editor;

  if p_is_editor then
    if not exists (
      select 1
      from public.department_members dm
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

  if v_was_editor is distinct from coalesce(p_is_editor, false) then
    perform public._owner_write_audit(
      auth.uid(),
      p_user_id,
      case when p_is_editor then 'editor_granted' else 'editor_revoked' end,
      jsonb_build_object('department_key', v_department_key)
    );
  end if;
end;
$$;

create or replace function public.service_owner_revoke_sessions(
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if p_actor_user_id is null or p_target_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if p_actor_user_id = p_target_user_id then
    raise exception 'SELF_ACTION_DENIED';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.user_id = p_actor_user_id and p.role = 'owner'
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.user_id = p_target_user_id and p.role = 'owner'
  ) then
    raise exception 'OWNER_ACTION_DENIED';
  end if;

  delete from auth.sessions
  where user_id = p_target_user_id;

  get diagnostics v_deleted = row_count;

  perform public._owner_write_audit(
    p_actor_user_id,
    p_target_user_id,
    'sessions_revoked',
    jsonb_build_object('session_count', v_deleted)
  );

  return v_deleted;
end;
$$;

create or replace function public.service_owner_record_auth_action(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_action not in (
    'password_recovery_sent',
    'user_blocked',
    'user_unblocked',
    'user_deleted'
  ) then
    raise exception 'INVALID_AUDIT_ACTION';
  end if;

  perform public._owner_write_audit(
    p_actor_user_id,
    p_target_user_id,
    p_action,
    p_details
  );
end;
$$;

revoke all on function public.owner_list_users_v2() from public;
revoke all on function public.owner_update_user_profile(uuid, text, text, text, text, text, date, numeric) from public;
revoke all on function public.owner_list_user_timesheets(uuid, integer) from public;
revoke all on function public.owner_list_user_audit(uuid, integer) from public;
revoke all on function public.owner_set_user_department(uuid, text) from public;
revoke all on function public.owner_set_department_editor(text, uuid, boolean) from public;
revoke all on function public.service_owner_revoke_sessions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.service_owner_record_auth_action(uuid, uuid, text, jsonb) from public, anon, authenticated;

grant execute on function public.owner_list_users_v2() to authenticated;
grant execute on function public.owner_update_user_profile(uuid, text, text, text, text, text, date, numeric) to authenticated;
grant execute on function public.owner_list_user_timesheets(uuid, integer) to authenticated;
grant execute on function public.owner_list_user_audit(uuid, integer) to authenticated;
grant execute on function public.owner_set_user_department(uuid, text) to authenticated;
grant execute on function public.owner_set_department_editor(text, uuid, boolean) to authenticated;
grant execute on function public.service_owner_revoke_sessions(uuid, uuid) to service_role;
grant execute on function public.service_owner_record_auth_action(uuid, uuid, text, jsonb) to service_role;

commit;
