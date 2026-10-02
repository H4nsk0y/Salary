-- Return the current user's startup data in one protected request.
-- Only the caller's profile and own department access are exposed.

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

revoke all on function public.get_my_app_context() from public, anon;
grant execute on function public.get_my_app_context() to authenticated;

comment on function public.get_my_app_context() is
  'Returns the authenticated caller profile and own department access for application startup.';
