begin;

create or replace function public.owner_get_database_health()
returns table (
  used_bytes bigint,
  limit_bytes bigint,
  used_percent numeric
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limit_bytes constant bigint := 500 * 1024 * 1024;
  v_used_bytes bigint;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;

  v_used_bytes := pg_database_size(current_database());

  return query
  select
    v_used_bytes,
    v_limit_bytes,
    round((v_used_bytes::numeric / v_limit_bytes::numeric) * 100, 2);
end;
$$;

revoke all on function public.owner_get_database_health()
from public, anon;
grant execute on function public.owner_get_database_health()
to authenticated;

commit;
