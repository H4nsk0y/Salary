-- Separate leader RPCs. No additional table grants or relaxed owner RPCs.
begin;

create or replace function public._leader_users_department(p_user_id uuid default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text;
begin
  if auth.uid() is null then raise exception 'ACCESS_DENIED'; end if;
  select de.department_key into v_key from public.department_editors de
    where de.user_id = auth.uid() and de.is_leader for share;
  if v_key is null then raise exception 'ACCESS_DENIED'; end if;
  if p_user_id is not null then
    perform 1 from public.department_members dm
      where dm.department_key = v_key and dm.user_id = p_user_id for share;
    if not found then raise exception 'USER_NOT_IN_DEPARTMENT'; end if;
  end if;
  return v_key;
end;
$$;
revoke all on function public._leader_users_department(uuid) from public, anon, authenticated;

create or replace function public.leader_list_department_users()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text := public._leader_users_department(); v_result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.user_id, 'display_name', p.display_name, 'position', p.position,
    'tab_number', p.tab_number, 'branch', p.branch, 'employment_date', p.employment_date,
    'weekly_hours', p.weekly_hours, 'oklad', p.oklad,
    'position_locked', coalesce(r.position_locked, false),
    'no_night_shifts', coalesce(c.no_night_shifts, false),
    'is_editor', coalesce(de.is_manual_editor, false),
    'is_leader', coalesce(de.is_leader, false)
  ) order by p.display_name, p.user_id), '[]'::jsonb) into v_result
  from public.department_members dm join public.profiles p on p.user_id = dm.user_id
  left join public.user_profile_restrictions r on r.user_id = p.user_id
  left join public.user_schedule_constraints c on c.user_id = p.user_id
  left join public.department_editors de on de.user_id = p.user_id and de.department_key = v_key
  where dm.department_key = v_key;
  return jsonb_build_object('department_key', v_key,
    'department_name', (select name from public.departments where key = v_key), 'users', v_result);
end;
$$;

create or replace function public.leader_update_department_user(p_user_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text; v_before jsonb; v_after jsonb;
begin
  if p_user_id is null then raise exception 'USER_REQUIRED'; end if;
  v_key := public._leader_users_department(p_user_id);
  if jsonb_typeof(p_patch) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_patch) k where k not in
      ('position','tab_number','branch','employment_date','weekly_hours','oklad')
  ) then raise exception 'INVALID_PROFILE_FIELDS'; end if;
  if p_patch ? 'weekly_hours' and (p_patch->>'weekly_hours') is not null
    and (p_patch->>'weekly_hours')::numeric not in (35,40) then raise exception 'INVALID_WEEKLY_HOURS'; end if;
  if p_patch ? 'oklad' and (p_patch->>'oklad')::numeric < 0 then raise exception 'INVALID_OKLAD'; end if;
  if p_patch ? 'branch' and nullif(p_patch->>'branch','') is not null and
    p_patch->>'branch' not in ('chateau_alvisa','alvisa_whisky','alvisa_beverage',
      'alvisa_whisky_distillery','kin_wine_cognac_factory','contract_odyssey') then raise exception 'INVALID_BRANCH'; end if;
  select jsonb_build_object('position', position, 'tab_number', tab_number, 'branch', branch,
    'employment_date', employment_date, 'weekly_hours', weekly_hours, 'oklad', oklad)
    into v_before from public.profiles where user_id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if p_patch ? 'position' and nullif(btrim(p_patch->>'position'),'') is distinct from (v_before->>'position')
    and exists (select 1 from public.user_profile_restrictions where user_id=p_user_id and position_locked)
  then raise exception 'POSITION_CHANGE_LOCKED'; end if;
  -- Existing position-lock and reserved-leader-position triggers remain active.
  update public.profiles set
    position = case when p_patch ? 'position' then nullif(btrim(p_patch->>'position'),'') else position end,
    tab_number = case when p_patch ? 'tab_number' then nullif(btrim(p_patch->>'tab_number'),'') else tab_number end,
    branch = case when p_patch ? 'branch' then nullif(p_patch->>'branch','') else branch end,
    employment_date = case when p_patch ? 'employment_date' then nullif(p_patch->>'employment_date','')::date else employment_date end,
    weekly_hours = case when p_patch ? 'weekly_hours' then (p_patch->>'weekly_hours')::numeric else weekly_hours end,
    oklad = case when p_patch ? 'oklad' then (p_patch->>'oklad')::numeric else oklad end
  where user_id = p_user_id;
  select jsonb_build_object('position', position, 'tab_number', tab_number, 'branch', branch,
    'employment_date', employment_date, 'weekly_hours', weekly_hours, 'oklad', oklad)
    into v_after from public.profiles where user_id = p_user_id;
  if v_before is distinct from v_after then
    insert into public.owner_audit_log(actor_user_id,target_user_id,action,details)
    values (auth.uid(),p_user_id,'profile_updated',jsonb_build_object(
      'source','department_leader','department_key',v_key,'before',v_before,'after',v_after));
  end if;
end;
$$;

create or replace function public.leader_set_department_user_flag(p_user_id uuid, p_flag text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text;
begin
  if p_user_id is null or p_enabled is null then raise exception 'USER_AND_STATE_REQUIRED'; end if;
  v_key := public._leader_users_department(p_user_id);
  if p_flag = 'editor' then
    if p_enabled then
      insert into public.department_editors(department_key,user_id,is_manual_editor,is_leader)
      values (v_key,p_user_id,true,false)
      on conflict (department_key,user_id) do update set is_manual_editor = true;
    else
      delete from public.department_editors where department_key=v_key and user_id=p_user_id and not is_leader;
      update public.department_editors set is_manual_editor=false where department_key=v_key and user_id=p_user_id and is_leader;
    end if;
  elsif p_flag = 'no_night_shifts' then
    insert into public.user_schedule_constraints(user_id,no_night_shifts,updated_at,updated_by)
    values (p_user_id,p_enabled,now(),auth.uid()) on conflict (user_id) do update
      set no_night_shifts=excluded.no_night_shifts,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  else raise exception 'INVALID_USER_FLAG'; end if;
  insert into public.owner_audit_log(actor_user_id,target_user_id,action,details)
  values (auth.uid(),p_user_id,case when p_flag='editor' then
    case when p_enabled then 'editor_granted' else 'editor_revoked' end else 'night_shift_restriction_updated' end,
    jsonb_build_object('source','department_leader','department_key',v_key,'flag',p_flag,'enabled',p_enabled));
end;
$$;

create or replace function public.leader_get_user_timesheet(p_user_id uuid, p_year integer, p_month integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text; v_payload jsonb;
begin
  if p_user_id is null then raise exception 'USER_REQUIRED'; end if;
  v_key := public._leader_users_department(p_user_id);
  if p_month not between 0 and 11 or p_year not between 2000 and 2100 then raise exception 'INVALID_MONTH'; end if;
  select jsonb_build_object('dayHours',payload->'dayHours','nightHours',payload->'nightHours',
    'leaveType',payload->'leaveType') into v_payload from public.timesheets
    where user_id=p_user_id and year=p_year and month=p_month;
  return v_payload;
end;
$$;

revoke all on function public.leader_list_department_users() from public, anon;
revoke all on function public.leader_update_department_user(uuid,jsonb) from public, anon;
revoke all on function public.leader_set_department_user_flag(uuid,text,boolean) from public, anon;
revoke all on function public.leader_get_user_timesheet(uuid,integer,integer) from public, anon;
grant execute on function public.leader_list_department_users() to authenticated;
grant execute on function public.leader_update_department_user(uuid,jsonb) to authenticated;
grant execute on function public.leader_set_department_user_flag(uuid,text,boolean) to authenticated;
grant execute on function public.leader_get_user_timesheet(uuid,integer,integer) to authenticated;
commit;
