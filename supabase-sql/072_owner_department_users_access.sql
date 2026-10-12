-- Owner access to the leader-facing page. No new UI buttons or table grants.
begin;
create or replace function public._leader_users_department(p_user_id uuid default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text;
begin
  if auth.uid() is null then raise exception 'ACCESS_DENIED'; end if;
  if public.is_owner() then
    select dm.department_key into v_key from public.department_members dm
      where dm.user_id = coalesce(p_user_id, auth.uid()) order by dm.department_key limit 1 for share;
    if v_key is null and p_user_id is null then
      select d.key into v_key from public.departments d order by d.key limit 1;
    end if;
  else
    select de.department_key into v_key from public.department_editors de
      where de.user_id = auth.uid() and de.is_leader for share;
  end if;
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
commit;
