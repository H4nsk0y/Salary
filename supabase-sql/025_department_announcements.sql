-- Short announcements for a department or, for the owner, for all users.
-- Messages use the existing notification center and expire after seven days.

create or replace function public.send_department_announcement(
  p_department_key text,
  p_title text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_is_global boolean := v_department_key is null;
  v_recipient_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if char_length(v_title) < 2 or char_length(v_title) > 80 then
    raise exception 'INVALID_TITLE';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'INVALID_BODY';
  end if;

  if v_is_global then
    if not public.is_owner() then
      raise exception 'ACCESS_DENIED';
    end if;

    insert into public.user_notifications (
      user_id,
      actor_user_id,
      department_key,
      type,
      title,
      body,
      url,
      expires_at
    )
    select
      profile.user_id,
      auth.uid(),
      membership.department_key,
      'department_announcement',
      v_title,
      v_body,
      'profile.html',
      now() + interval '7 days'
    from public.profiles profile
    left join lateral (
      select member.department_key
      from public.department_members member
      where member.user_id = profile.user_id
      order by member.created_at asc
      limit 1
    ) membership on true
    where profile.user_id <> auth.uid();
  else
    if not public.can_edit_department(v_department_key) then
      raise exception 'ACCESS_DENIED';
    end if;

    if not exists (
      select 1
      from public.departments department
      where department.key = v_department_key
    ) then
      raise exception 'DEPARTMENT_NOT_FOUND';
    end if;

    insert into public.user_notifications (
      user_id,
      actor_user_id,
      department_key,
      type,
      title,
      body,
      url,
      expires_at
    )
    select
      member.user_id,
      auth.uid(),
      v_department_key,
      'department_announcement',
      v_title,
      v_body,
      'profile.html',
      now() + interval '7 days'
    from public.department_members member
    where member.department_key = v_department_key
      and member.user_id <> auth.uid();
  end if;

  get diagnostics v_recipient_count = row_count;

  return jsonb_build_object(
    'recipient_count', v_recipient_count,
    'is_global', v_is_global,
    'department_key', v_department_key
  );
end;
$$;

revoke all on function public.send_department_announcement(text, text, text) from public;
grant execute on function public.send_department_announcement(text, text, text) to authenticated;

