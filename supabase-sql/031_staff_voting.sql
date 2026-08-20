-- Anonymous employee voting: one vote per account for each week and month.
-- Voter ids are stored only to enforce uniqueness and are never returned by RPCs.

create table if not exists public.staff_votes (
  id bigint generated always as identity primary key,
  voter_user_id uuid not null references auth.users(id) on delete cascade,
  nominee_user_id uuid not null references public.profiles(user_id) on delete cascade,
  period_type text not null check (period_type in ('week', 'month')),
  period_start date not null,
  comment text,
  created_at timestamptz not null default now(),
  constraint staff_votes_not_self check (voter_user_id <> nominee_user_id),
  constraint staff_votes_comment_length check (comment is null or char_length(comment) <= 500),
  unique (voter_user_id, period_type, period_start)
);

create index if not exists staff_votes_period_idx
on public.staff_votes (period_type, period_start, nominee_user_id);

create table if not exists public.staff_vote_results (
  id bigint generated always as identity primary key,
  period_type text not null check (period_type in ('week', 'month')),
  period_start date not null,
  period_end date not null,
  winner_user_id uuid references public.profiles(user_id) on delete set null,
  winner_display_name text,
  winner_avatar_url text,
  winner_department_name text,
  honorable_mentions jsonb not null default '[]'::jsonb,
  top_votes integer not null default 0,
  total_votes integer not null default 0,
  finalized_at timestamptz not null default now(),
  unique (period_type, period_start),
  constraint staff_vote_results_period_check check (period_end > period_start),
  constraint staff_vote_results_counts_check check (
    top_votes >= 0 and total_votes >= 0 and top_votes <= total_votes
  )
);

alter table public.staff_votes enable row level security;
alter table public.staff_vote_results enable row level security;

revoke all on table public.staff_votes from anon, authenticated;
revoke all on table public.staff_vote_results from anon, authenticated;

create or replace function public.finalize_staff_vote_period(
  p_period_type text,
  p_period_start date,
  p_period_end date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_total_votes integer := 0;
  v_top_votes integer := 0;
  v_tied_user_ids uuid[] := array[]::uuid[];
  v_winner_user_id uuid;
  v_winner_display_name text;
  v_winner_avatar_url text;
  v_winner_department_name text;
  v_honorable_mentions jsonb := '[]'::jsonb;
begin
  if p_period_type not in ('week', 'month')
    or p_period_start is null
    or p_period_end is null
    or p_period_end <= p_period_start then
    raise exception 'INVALID_PERIOD';
  end if;

  if p_period_end > v_today then
    raise exception 'PERIOD_NOT_FINISHED';
  end if;

  if exists (
    select 1
    from public.staff_vote_results result
    where result.period_type = p_period_type
      and result.period_start = p_period_start
  ) then
    return;
  end if;

  select count(*)::integer
  into v_total_votes
  from public.staff_votes vote
  where vote.period_type = p_period_type
    and vote.period_start = p_period_start;

  if v_total_votes > 0 then
    with totals as (
      select vote.nominee_user_id, count(*)::integer as vote_count
      from public.staff_votes vote
      where vote.period_type = p_period_type
        and vote.period_start = p_period_start
      group by vote.nominee_user_id
    )
    select max(totals.vote_count)
    into v_top_votes
    from totals;

    with totals as (
      select vote.nominee_user_id, count(*)::integer as vote_count
      from public.staff_votes vote
      where vote.period_type = p_period_type
        and vote.period_start = p_period_start
      group by vote.nominee_user_id
    )
    select coalesce(array_agg(totals.nominee_user_id order by totals.nominee_user_id), array[]::uuid[])
    into v_tied_user_ids
    from totals
    where totals.vote_count = v_top_votes;

    v_winner_user_id := v_tied_user_ids[
      floor(random() * array_length(v_tied_user_ids, 1))::integer + 1
    ];

    select
      coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.position), ''), 'Сотрудник'),
      profile.avatar_url,
      coalesce(department.name, 'Без отдела')
    into
      v_winner_display_name,
      v_winner_avatar_url,
      v_winner_department_name
    from public.profiles profile
    left join lateral (
      select member.department_key
      from public.department_members member
      where member.user_id = profile.user_id
      order by member.created_at, member.department_key
      limit 1
    ) primary_membership on true
    left join public.departments department on department.key = primary_membership.department_key
    where profile.user_id = v_winner_user_id;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id', profile.user_id,
          'display_name', coalesce(
            nullif(btrim(profile.display_name), ''),
            nullif(btrim(profile.position), ''),
            'Сотрудник'
          ),
          'department_name', coalesce(department.name, 'Без отдела')
        )
        order by coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.position), ''), profile.user_id::text)
      ),
      '[]'::jsonb
    )
    into v_honorable_mentions
    from unnest(v_tied_user_ids) tied(user_id)
    join public.profiles profile on profile.user_id = tied.user_id
    left join lateral (
      select member.department_key
      from public.department_members member
      where member.user_id = profile.user_id
      order by member.created_at, member.department_key
      limit 1
    ) primary_membership on true
    left join public.departments department on department.key = primary_membership.department_key
    where tied.user_id <> v_winner_user_id;
  end if;

  insert into public.staff_vote_results (
    period_type,
    period_start,
    period_end,
    winner_user_id,
    winner_display_name,
    winner_avatar_url,
    winner_department_name,
    honorable_mentions,
    top_votes,
    total_votes
  )
  values (
    p_period_type,
    p_period_start,
    p_period_end,
    v_winner_user_id,
    v_winner_display_name,
    v_winner_avatar_url,
    v_winner_department_name,
    v_honorable_mentions,
    v_top_votes,
    v_total_votes
  )
  on conflict (period_type, period_start) do nothing;
end;
$$;

create or replace function public.list_staff_vote_candidates()
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  department_key text,
  department_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  return query
  select
    profile.user_id,
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(profile.position), ''),
      'Сотрудник'
    ) as display_name,
    profile.avatar_url,
    primary_membership.department_key,
    coalesce(department.name, primary_membership.department_key) as department_name
  from public.profiles profile
  join lateral (
    select member.department_key
    from public.department_members member
    where member.user_id = profile.user_id
    order by member.created_at, member.department_key
    limit 1
  ) primary_membership on true
  left join public.departments department on department.key = primary_membership.department_key
  where profile.user_id <> auth.uid()
  order by
    coalesce(department.name, primary_membership.department_key),
    coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.position), ''), profile.user_id::text);
end;
$$;

create or replace function public.get_staff_vote_periods()
returns table (
  period_type text,
  current_period_start date,
  current_period_end date,
  has_voted boolean,
  previous_period_start date,
  previous_period_end date,
  winner_user_id uuid,
  winner_display_name text,
  winner_avatar_url text,
  winner_department_name text,
  honorable_mentions jsonb,
  top_votes integer,
  total_votes integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local_now timestamp := now() at time zone 'Europe/Moscow';
  v_week_start date := date_trunc('week', v_local_now)::date;
  v_month_start date := date_trunc('month', v_local_now)::date;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  perform public.finalize_staff_vote_period('week', v_week_start - 7, v_week_start);
  perform public.finalize_staff_vote_period(
    'month',
    (v_month_start - interval '1 month')::date,
    v_month_start
  );

  return query
  select
    source.period_type,
    source.current_start,
    source.current_end,
    exists (
      select 1
      from public.staff_votes own_vote
      where own_vote.voter_user_id = auth.uid()
        and own_vote.period_type = source.period_type
        and own_vote.period_start = source.current_start
    ) as has_voted,
    source.previous_start,
    source.previous_end,
    result.winner_user_id,
    result.winner_display_name,
    result.winner_avatar_url,
    result.winner_department_name,
    coalesce(result.honorable_mentions, '[]'::jsonb),
    coalesce(result.top_votes, 0),
    coalesce(result.total_votes, 0)
  from (
    values
      ('week'::text, v_week_start, v_week_start + 7, v_week_start - 7, v_week_start),
      (
        'month'::text,
        v_month_start,
        (v_month_start + interval '1 month')::date,
        (v_month_start - interval '1 month')::date,
        v_month_start
      )
  ) source(period_type, current_start, current_end, previous_start, previous_end)
  left join public.staff_vote_results result
    on result.period_type = source.period_type
   and result.period_start = source.previous_start
  order by case source.period_type when 'week' then 1 else 2 end;
end;
$$;

create or replace function public.submit_staff_vote(
  p_period_type text,
  p_nominee_user_id uuid,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local_now timestamp := now() at time zone 'Europe/Moscow';
  v_period_start date;
  v_comment text := nullif(btrim(p_comment), '');
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if p_period_type = 'week' then
    v_period_start := date_trunc('week', v_local_now)::date;
  elsif p_period_type = 'month' then
    v_period_start := date_trunc('month', v_local_now)::date;
  else
    raise exception 'INVALID_PERIOD_TYPE';
  end if;

  if p_nominee_user_id is null then
    raise exception 'NOMINEE_REQUIRED';
  end if;

  if p_nominee_user_id = auth.uid() then
    raise exception 'SELF_VOTE_DENIED';
  end if;

  if not exists (
    select 1
    from public.department_members member
    where member.user_id = p_nominee_user_id
  ) then
    raise exception 'NOMINEE_NOT_FOUND';
  end if;

  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'COMMENT_TOO_LONG';
  end if;

  insert into public.staff_votes (
    voter_user_id,
    nominee_user_id,
    period_type,
    period_start,
    comment
  )
  values (
    auth.uid(),
    p_nominee_user_id,
    p_period_type,
    v_period_start,
    v_comment
  );
exception
  when unique_violation then
    raise exception 'ALREADY_VOTED';
end;
$$;

create or replace function public.list_completed_staff_vote_comments(
  p_period_type text,
  p_period_start date
)
returns table (
  nominee_display_name text,
  nominee_department_name text,
  comment text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if p_period_type not in ('week', 'month') or p_period_start is null then
    raise exception 'INVALID_PERIOD';
  end if;

  if not exists (
    select 1
    from public.staff_vote_results result
    where result.period_type = p_period_type
      and result.period_start = p_period_start
  ) then
    raise exception 'RESULT_NOT_READY';
  end if;

  return query
  select
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(profile.position), ''),
      'Сотрудник'
    ) as nominee_display_name,
    coalesce(department.name, 'Без отдела') as nominee_department_name,
    vote.comment,
    vote.created_at
  from public.staff_votes vote
  join public.profiles profile on profile.user_id = vote.nominee_user_id
  left join lateral (
    select member.department_key
    from public.department_members member
    where member.user_id = profile.user_id
    order by member.created_at, member.department_key
    limit 1
  ) primary_membership on true
  left join public.departments department on department.key = primary_membership.department_key
  where vote.period_type = p_period_type
    and vote.period_start = p_period_start
    and nullif(btrim(vote.comment), '') is not null
  order by vote.created_at, vote.id;
end;
$$;

revoke all on function public.finalize_staff_vote_period(text, date, date) from public, anon, authenticated;
revoke all on function public.list_staff_vote_candidates() from public, anon;
revoke all on function public.get_staff_vote_periods() from public, anon;
revoke all on function public.submit_staff_vote(text, uuid, text) from public, anon;
revoke all on function public.list_completed_staff_vote_comments(text, date) from public, anon;

grant execute on function public.list_staff_vote_candidates() to authenticated;
grant execute on function public.get_staff_vote_periods() to authenticated;
grant execute on function public.submit_staff_vote(text, uuid, text) to authenticated;
grant execute on function public.list_completed_staff_vote_comments(text, date) to authenticated;
