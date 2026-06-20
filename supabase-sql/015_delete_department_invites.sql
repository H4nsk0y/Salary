create or replace function public.owner_delete_department_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(p_token), '');
  v_department_key text;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_token is null then
    raise exception 'INVITE_TOKEN_REQUIRED';
  end if;

  select i.department_key
  into v_department_key
  from public.department_invites i
  where i.token = v_token;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  delete from public.department_invites
  where token = v_token;
end;
$$;

revoke all on function public.owner_delete_department_invite(text) from public;
grant execute on function public.owner_delete_department_invite(text) to authenticated;
