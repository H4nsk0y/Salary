-- Read-only deployment checks. No secrets or actual personal data are returned.
-- Review policy details first; the compact verdict is the final SQL result.
select tablename, policyname, permissive, cmd, roles, qual, with_check from pg_policies
where schemaname = 'public' and tablename in (
  'profiles', 'timesheets', 'department_editors', 'department_members',
  'owner_audit_log', 'department_timesheet_audit_log', 'user_profile_restrictions', 'user_schedule_constraints'
)
order by tablename, policyname;

select
  not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') as role_update_blocked,
  not has_column_privilege('authenticated', 'public.profiles', 'role', 'INSERT') as role_insert_blocked,
  not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE') as created_at_update_blocked,
  not has_schema_privilege('authenticated', 'public', 'CREATE') as client_schema_creation_blocked,
  not has_any_column_privilege('authenticated', 'public.department_editors', 'INSERT')
    and not has_any_column_privilege('authenticated', 'public.department_editors', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.department_editors', 'DELETE') as direct_editor_changes_blocked,
  exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass
    and tgname = 'enforce_profile_privilege_boundary' and tgenabled <> 'D') as privilege_trigger_installed,
  exists (select 1 from pg_trigger where tgrelid = 'auth.sessions'::regclass
    and tgname = 'alvisa_owner_session_created' and tgenabled <> 'D') as owner_login_trigger_installed,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles'
    and policyname in ('profiles_read_boundary', 'profiles_insert_boundary', 'profiles_update_boundary')
    and permissive = 'RESTRICTIVE') = 3 as profile_boundaries_installed,
  coalesce((select jsonb_agg(p.oid::regprocedure::text) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
    and (p.proname like '\_owner\_%' escape '\' or p.proname like 'service\_owner\_%' escape '\')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ), '[]'::jsonb) as exposed_internal_owner_helpers,
  coalesce((select jsonb_agg(p.oid::regprocedure::text) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
    and p.proname like 'owner\_%' escape '\'
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or not p.prosecdef
      or (pg_get_functiondef(p.oid) !~ 'is_owner\s*\('
        and not (coalesce(p.oid::regprocedure = any(array[
          to_regprocedure('public.owner_create_department_invite(text,integer,integer)'),
          to_regprocedure('public.owner_revoke_department_invite(text)'),
          to_regprocedure('public.owner_delete_department_invite(text)'),
          to_regprocedure('public.owner_list_department_members(text)'),
          to_regprocedure('public.owner_list_available_profiles(text)'),
          to_regprocedure('public.owner_list_department_editors(text)'),
          to_regprocedure('public.owner_add_department_member(text,uuid)'),
          to_regprocedure('public.owner_remove_department_member(text,uuid)')
        ]), false) and pg_get_functiondef(p.oid) ~ 'can_edit_department\s*\(')))
  ), '[]'::jsonb) as owner_rpc_needing_review;
