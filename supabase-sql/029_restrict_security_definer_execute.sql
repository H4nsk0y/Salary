-- Remove implicit anonymous access from SECURITY DEFINER functions.
-- Existing authenticated application calls keep explicit EXECUTE permission.

begin;

-- The auth.users trigger invokes this function internally; clients never should.
alter function public.handle_new_user()
  set search_path = public, pg_temp;

do $$
declare
  function_row record;
  handle_new_user_oid oid := 'public.handle_new_user()'::regprocedure::oid;
begin
  for function_row in
    select
      p.oid,
      p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format(
      'revoke execute on function %s from public, anon',
      function_row.signature
    );

    if function_row.oid <> handle_new_user_oid then
      execute format(
        'grant execute on function %s to authenticated',
        function_row.signature
      );
    end if;
  end loop;
end $$;

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

commit;
