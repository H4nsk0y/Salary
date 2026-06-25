begin;

create table if not exists public.easter_runner_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  score integer not null default 0,
  passed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, mode),
  constraint easter_runner_scores_mode_check check (mode in ('normal', 'hardcore')),
  constraint easter_runner_scores_score_check check (score >= 0 and score <= 1000000),
  constraint easter_runner_scores_passed_check check (passed >= 0 and passed <= 1000000)
);

create index if not exists easter_runner_scores_mode_score_idx
on public.easter_runner_scores (mode, score desc, passed desc, updated_at asc);

alter table public.easter_runner_scores enable row level security;

revoke all on public.easter_runner_scores from anon, authenticated;

create or replace function public.submit_easter_runner_score(
  p_mode text,
  p_score integer,
  p_passed integer
)
returns table (
  is_personal_best boolean,
  score integer,
  passed integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := lower(nullif(btrim(p_mode), ''));
  v_score integer := coalesce(p_score, 0);
  v_passed integer := coalesce(p_passed, 0);
  v_old_score integer;
  v_old_passed integer;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_mode not in ('normal', 'hardcore') then
    raise exception 'INVALID_MODE';
  end if;

  if v_score < 0 or v_score > 1000000 or v_passed < 0 or v_passed > 1000000 then
    raise exception 'INVALID_SCORE';
  end if;

  select s.score, s.passed
  into v_old_score, v_old_passed
  from public.easter_runner_scores s
  where s.user_id = auth.uid()
    and s.mode = v_mode;

  if v_old_score is null then
    insert into public.easter_runner_scores (user_id, mode, score, passed)
    values (auth.uid(), v_mode, v_score, v_passed);

    is_personal_best := true;
  elsif v_score > v_old_score or (v_score = v_old_score and v_passed > v_old_passed) then
    update public.easter_runner_scores s
    set
      score = v_score,
      passed = v_passed,
      updated_at = now()
    where s.user_id = auth.uid()
      and s.mode = v_mode;

    is_personal_best := true;
  else
    is_personal_best := false;
  end if;

  return query
  select
    is_personal_best,
    s.score,
    s.passed,
    s.updated_at
  from public.easter_runner_scores s
  where s.user_id = auth.uid()
    and s.mode = v_mode;
end;
$$;

create or replace function public.list_easter_runner_leaderboard(
  p_mode text,
  p_limit integer default 5
)
returns table (
  rank integer,
  user_id uuid,
  display_name text,
  score integer,
  passed integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := lower(nullif(btrim(p_mode), ''));
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_mode not in ('normal', 'hardcore') then
    raise exception 'INVALID_MODE';
  end if;

  return query
  select
    row_number() over (
      order by s.score desc, s.passed desc, s.updated_at asc, s.user_id
    )::integer as rank,
    s.user_id,
    coalesce(
      nullif(btrim(p.display_name), ''),
      nullif(btrim(p.position), ''),
      'Сотрудник'
    ) as display_name,
    s.score,
    s.passed,
    s.updated_at
  from public.easter_runner_scores s
  left join public.profiles p on p.user_id = s.user_id
  where s.mode = v_mode
  order by s.score desc, s.passed desc, s.updated_at asc, s.user_id
  limit v_limit;
end;
$$;

revoke all on function public.submit_easter_runner_score(text, integer, integer) from public;
revoke all on function public.list_easter_runner_leaderboard(text, integer) from public;

grant execute on function public.submit_easter_runner_score(text, integer, integer) to authenticated;
grant execute on function public.list_easter_runner_leaderboard(text, integer) to authenticated;

commit;
