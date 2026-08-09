-- Read-only security report. Run after 026_security_hardening.sql.
-- This script changes nothing and returns the effective database configuration.

select
  c.grantee,
  c.table_schema,
  c.table_name,
  c.privilege_type,
  c.is_grantable
from information_schema.role_table_grants c
where c.grantee in ('anon', 'authenticated')
  and c.table_schema in ('public', 'storage')
order by c.table_schema, c.table_name, c.grantee, c.privilege_type;

select
  c.grantee,
  c.table_schema,
  c.table_name,
  c.column_name,
  c.privilege_type
from information_schema.role_column_grants c
where c.grantee = 'authenticated'
  and c.table_schema = 'public'
  and c.table_name = 'profiles'
order by c.column_name, c.privilege_type;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, arguments;

select
  n.nspname as schema_name,
  p.proname as unsafe_security_definer_function,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and not exists (
    select 1
    from unnest(coalesce(p.proconfig, array[]::text[])) setting
    where setting like 'search_path=%'
  )
order by p.proname;

select
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema in ('public', 'storage')
order by event_object_schema, event_object_table, trigger_name;

-- Compact final result for SQL Editor, which may display only the last result set.
select
  not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
    as profile_role_update_blocked,
  not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE')
    as profile_created_at_update_blocked,
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
    as profile_business_fields_update_allowed,
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass)
    as profiles_rls_enabled,
  (select relrowsecurity from pg_class where oid = 'public.timesheets'::regclass)
    as timesheets_rls_enabled,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'trg_validate_profile_write'
      and not tgisinternal
  ) as profile_validator_installed,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.timesheets'::regclass
      and tgname = 'trg_validate_timesheet_write'
      and not tgisinternal
  ) as timesheet_validator_installed,
  coalesce((
    select jsonb_agg(
      format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      order by p.proname
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ), '[]'::jsonb) as unsafe_security_definer_functions,
  coalesce((
    select jsonb_agg(
      format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      order by p.proname
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ), '[]'::jsonb) as anon_executable_security_definer_functions;
