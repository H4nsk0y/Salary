-- Notify the author when the owner marks a project idea as reviewed.

begin;

create or replace function public.owner_set_project_idea_status(
  p_idea_id bigint,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idea public.project_ideas%rowtype;
  v_preview text;
begin
  if not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_status not in ('new', 'reviewed', 'archived') then
    raise exception 'INVALID_IDEA_STATUS';
  end if;

  select *
  into v_idea
  from public.project_ideas
  where id = p_idea_id
  for update;

  if not found then
    raise exception 'IDEA_NOT_FOUND';
  end if;

  update public.project_ideas
  set
    status = p_status,
    reviewed_at = case when p_status = 'new' then null else now() end
  where id = p_idea_id;

  if p_status = 'reviewed' and v_idea.status is distinct from 'reviewed' then
    v_preview := left(regexp_replace(btrim(v_idea.idea_text), '[[:space:]]+', ' ', 'g'), 140);

    insert into public.user_notifications (
      user_id,
      actor_user_id,
      type,
      title,
      body,
      url,
      expires_at
    ) values (
      v_idea.user_id,
      auth.uid(),
      'project_idea_reviewed',
      'Ваша идея рассмотрена',
      'Предложение «' || v_preview || case when char_length(v_idea.idea_text) > 140 then '…' else '' end || '» отмечено как рассмотренное.',
      'profile.html',
      now() + interval '7 days'
    );
  end if;
end;
$$;

revoke all on function public.owner_set_project_idea_status(bigint, text) from public, anon;
grant execute on function public.owner_set_project_idea_status(bigint, text) to authenticated;

commit;
