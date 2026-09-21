-- Notify every owner when an authenticated user submits a project idea.

begin;

create or replace function public.submit_project_idea(p_idea_text text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_text text := regexp_replace(btrim(coalesce(p_idea_text, '')), '[[:space:]]+', ' ', 'g');
  v_preview text;
  v_id bigint;
begin
  if v_user_id is null then
    raise exception 'NO_SESSION';
  end if;
  if char_length(v_text) not between 10 and 2000 then
    raise exception 'INVALID_IDEA_TEXT';
  end if;
  if (
    select count(*)
    from public.project_ideas idea
    where idea.user_id = v_user_id
      and idea.created_at >= now() - interval '24 hours'
  ) >= 10 then
    raise exception 'IDEA_RATE_LIMIT';
  end if;

  insert into public.project_ideas (user_id, idea_text)
  values (v_user_id, v_text)
  returning id into v_id;

  v_preview := left(v_text, 160);

  insert into public.user_notifications (
    user_id,
    actor_user_id,
    type,
    title,
    body,
    url,
    expires_at
  )
  select
    owner_profile.user_id,
    v_user_id,
    'project_idea_submitted',
    'Новая идея от пользователя',
    '«' || v_preview || case when char_length(v_text) > 160 then '…' else '' end || '»',
    'owner-ideas.html',
    now() + interval '14 days'
  from public.profiles owner_profile
  where owner_profile.role = 'owner';

  return v_id;
end;
$$;

revoke all on function public.submit_project_idea(text) from public, anon;
grant execute on function public.submit_project_idea(text) to authenticated;

commit;
