-- Project ideas submitted by authenticated users and reviewed only by owner.

begin;

create table if not exists public.project_ideas (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  idea_text text not null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint project_ideas_text_check check (char_length(btrim(idea_text)) between 10 and 2000),
  constraint project_ideas_status_check check (status in ('new', 'reviewed', 'archived'))
);

create index if not exists project_ideas_status_created_idx
on public.project_ideas (status, created_at desc);

create index if not exists project_ideas_user_created_idx
on public.project_ideas (user_id, created_at desc);

alter table public.project_ideas enable row level security;
revoke all on table public.project_ideas from anon, authenticated;

create or replace function public.submit_project_idea(p_idea_text text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_text text := regexp_replace(btrim(coalesce(p_idea_text, '')), '[[:space:]]+', ' ', 'g');
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

  return v_id;
end;
$$;

create or replace function public.owner_list_project_ideas(p_status text default null)
returns table (
  id bigint,
  user_id uuid,
  display_name text,
  email text,
  department_key text,
  department_name text,
  idea_text text,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_status is not null and p_status not in ('new', 'reviewed', 'archived') then
    raise exception 'INVALID_IDEA_STATUS';
  end if;

  return query
  select
    idea.id,
    idea.user_id,
    coalesce(nullif(btrim(profile.display_name), ''), account.email, 'Пользователь') as display_name,
    account.email::text,
    membership.department_key,
    department.name as department_name,
    idea.idea_text,
    idea.status,
    idea.created_at,
    idea.reviewed_at
  from public.project_ideas idea
  join auth.users account on account.id = idea.user_id
  left join public.profiles profile on profile.user_id = idea.user_id
  left join lateral (
    select member.department_key
    from public.department_members member
    where member.user_id = idea.user_id
    order by member.created_at
    limit 1
  ) membership on true
  left join public.departments department on department.key = membership.department_key
  where p_status is null or idea.status = p_status
  order by
    case idea.status when 'new' then 1 when 'reviewed' then 2 else 3 end,
    idea.created_at desc;
end;
$$;

create or replace function public.owner_set_project_idea_status(
  p_idea_id bigint,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_status not in ('new', 'reviewed', 'archived') then
    raise exception 'INVALID_IDEA_STATUS';
  end if;

  update public.project_ideas
  set
    status = p_status,
    reviewed_at = case when p_status = 'new' then null else now() end
  where id = p_idea_id;

  if not found then
    raise exception 'IDEA_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.owner_delete_project_idea(p_idea_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'ACCESS_DENIED';
  end if;

  delete from public.project_ideas
  where id = p_idea_id;

  if not found then
    raise exception 'IDEA_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.submit_project_idea(text) from public, anon;
revoke all on function public.owner_list_project_ideas(text) from public, anon;
revoke all on function public.owner_set_project_idea_status(bigint, text) from public, anon;
revoke all on function public.owner_delete_project_idea(bigint) from public, anon;

grant execute on function public.submit_project_idea(text) to authenticated;
grant execute on function public.owner_list_project_ideas(text) to authenticated;
grant execute on function public.owner_set_project_idea_status(bigint, text) to authenticated;
grant execute on function public.owner_delete_project_idea(bigint) to authenticated;

commit;
