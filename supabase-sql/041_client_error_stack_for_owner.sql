-- Добавляет владельцу стек вызовов в диагностическую выдачу.
drop function if exists public.owner_list_client_errors(integer);

create or replace function public.owner_list_client_errors(p_limit integer default 20)
returns table (
  id bigint,
  user_id uuid,
  display_name text,
  kind text,
  message text,
  stack text,
  page text,
  context jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_owner() then
    raise exception 'OWNER_REQUIRED';
  end if;

  return query
  select
    errors.id,
    errors.user_id,
    coalesce(nullif(trim(profiles.display_name), ''), 'Сотрудник') as display_name,
    errors.kind,
    errors.message,
    errors.stack,
    errors.page,
    errors.context,
    errors.created_at
  from public.client_error_logs errors
  left join public.profiles on profiles.user_id = errors.user_id
  order by errors.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 1000);
end;
$$;

revoke all on function public.owner_list_client_errors(integer) from public, anon;
grant execute on function public.owner_list_client_errors(integer) to authenticated;
