-- Read-only diagnostic for legacy RPCs not represented in repository migrations.
-- Run before retrying 066 after REVIEW_OWNER_FUNCTION; inspect every returned body.
-- No account data, stored invite tokens or Vault secret values are queried.
select
  p.oid::regprocedure::text as signature,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and p.proname like 'owner\_%' escape '\'
  and (
    not p.prosecdef
    or (
      pg_get_functiondef(p.oid) !~ 'is_owner\s*\('
      and not (
        coalesce(p.oid::regprocedure = any(array[
          to_regprocedure('public.owner_create_department_invite(text,integer,integer)'),
          to_regprocedure('public.owner_revoke_department_invite(text)'),
          to_regprocedure('public.owner_delete_department_invite(text)'),
          to_regprocedure('public.owner_list_department_members(text)'),
          to_regprocedure('public.owner_list_available_profiles(text)'),
          to_regprocedure('public.owner_list_department_editors(text)'),
          to_regprocedure('public.owner_add_department_member(text,uuid)'),
          to_regprocedure('public.owner_remove_department_member(text,uuid)')
        ]), false)
        and pg_get_functiondef(p.oid) ~ 'can_edit_department\s*\('
      )
    )
  )
order by p.proname, p.oid::regprocedure::text;
