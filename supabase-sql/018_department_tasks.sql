begin;

create table if not exists public.department_tasks (
  id bigint generated always as identity primary key,
  department_key text not null references public.departments(key) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  task_date date not null,
  due_at timestamptz not null,
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint department_tasks_text_length check (char_length(btrim(text)) between 1 and 2000)
);

create table if not exists public.department_task_assignees (
  task_id bigint not null references public.department_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists department_tasks_department_due_idx
on public.department_tasks (department_key, due_at desc);

create index if not exists department_tasks_created_by_idx
on public.department_tasks (created_by, created_at desc);

create index if not exists department_task_assignees_user_idx
on public.department_task_assignees (user_id, task_id);

alter table public.department_tasks enable row level security;
alter table public.department_task_assignees enable row level security;

revoke all on public.department_tasks from anon, authenticated;
revoke all on public.department_task_assignees from anon, authenticated;

create or replace function public.cleanup_expired_department_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.user_notifications notification
  using public.department_tasks task
  where task.due_at <= now() - interval '8 hours'
    and notification.department_key = task.department_key
    and notification.type = 'department_task_assigned'
    and notification.url = 'tasks.html?task=' || task.id;

  delete from public.department_tasks
  where due_at <= now() - interval '8 hours';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_expired_department_tasks() from public;

create or replace function public.create_department_task(
  p_department_key text,
  p_task_date date,
  p_due_at timestamptz,
  p_text text,
  p_assignment_mode text,
  p_user_ids uuid[] default array[]::uuid[]
)
returns table (
  task_id bigint,
  assignee_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
  v_text text := nullif(btrim(p_text), '');
  v_mode text := lower(nullif(btrim(p_assignment_mode), ''));
  v_task_id bigint;
  v_assignee_count integer := 0;
  v_day_index integer;
  v_year integer;
  v_month integer;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_department_key is null then
    raise exception 'DEPARTMENT_REQUIRED';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  if p_task_date is null then
    raise exception 'TASK_DATE_REQUIRED';
  end if;

  if p_task_date < current_date - 31 or p_task_date > current_date + 366 then
    raise exception 'INVALID_TASK_DATE';
  end if;

  if p_due_at is null or p_due_at < now() - interval '5 minutes' then
    raise exception 'INVALID_DUE_AT';
  end if;

  if v_text is null then
    raise exception 'TASK_TEXT_REQUIRED';
  end if;

  if char_length(v_text) > 2000 then
    raise exception 'TASK_TEXT_TOO_LONG';
  end if;

  if v_mode not in ('selected', 'shift', 'department') then
    raise exception 'INVALID_ASSIGNMENT_MODE';
  end if;

  insert into public.department_tasks (
    department_key,
    created_by,
    task_date,
    due_at,
    text
  )
  values (
    v_department_key,
    auth.uid(),
    p_task_date,
    p_due_at,
    v_text
  )
  returning id into v_task_id;

  if v_mode = 'selected' then
    if coalesce(cardinality(p_user_ids), 0) = 0 then
      raise exception 'ASSIGNEES_REQUIRED';
    end if;

    if exists (
      select 1
      from unnest(p_user_ids) requested(user_id)
      where requested.user_id is null
        or not exists (
          select 1
          from public.department_members dm
          where dm.department_key = v_department_key
            and dm.user_id = requested.user_id
        )
    ) then
      raise exception 'RECIPIENT_NOT_IN_DEPARTMENT';
    end if;

    insert into public.department_task_assignees (task_id, user_id)
    select v_task_id, requested.user_id
    from (
      select distinct unnest(p_user_ids) as user_id
    ) requested;
  elsif v_mode = 'department' then
    insert into public.department_task_assignees (task_id, user_id)
    select v_task_id, dm.user_id
    from public.department_members dm
    where dm.department_key = v_department_key;
  else
    v_day_index := extract(day from p_task_date)::integer - 1;
    v_year := extract(year from p_task_date)::integer;
    v_month := extract(month from p_task_date)::integer - 1;

    insert into public.department_task_assignees (task_id, user_id)
    select v_task_id, dm.user_id
    from public.department_members dm
    left join public.timesheets t
      on t.user_id = dm.user_id
     and t.year = v_year
     and t.month = v_month
    left join lateral (
      select
        case
          when (t.payload -> 'dayHours' ->> v_day_index) ~ '^-?[0-9]+([.][0-9]+)?$'
            then (t.payload -> 'dayHours' ->> v_day_index)::numeric
          else 0::numeric
        end as day_hours,
        case
          when (t.payload -> 'nightHours' ->> v_day_index) ~ '^-?[0-9]+([.][0-9]+)?$'
            then (t.payload -> 'nightHours' ->> v_day_index)::numeric
          else 0::numeric
        end as night_hours
    ) shift_hours on true
    where dm.department_key = v_department_key
      and (shift_hours.day_hours + shift_hours.night_hours) > 0
      and not (
        abs(shift_hours.day_hours - 2) < 0.001
        and abs(shift_hours.night_hours - 5) < 0.001
      );
  end if;

  select count(*)::integer
  into v_assignee_count
  from public.department_task_assignees a
  where a.task_id = v_task_id;

  if v_assignee_count = 0 then
    raise exception 'NO_ASSIGNEES';
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
    a.user_id,
    auth.uid(),
    v_department_key,
    'department_task_assigned',
    'Новая задача',
    'На ' || to_char(p_task_date, 'DD.MM.YYYY') || ': ' || left(v_text, 500) ||
      '. Срок: ' || to_char(p_due_at at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI'),
    'tasks.html?task=' || v_task_id,
    now() + interval '7 days'
  from public.department_task_assignees a
  where a.task_id = v_task_id;

  return query select v_task_id, v_assignee_count;
end;
$$;

create or replace function public.list_my_department_tasks(
  p_department_key text default null,
  p_limit integer default 100
)
returns table (
  id bigint,
  department_key text,
  department_name text,
  created_by uuid,
  creator_name text,
  task_date date,
  due_at timestamptz,
  text text,
  created_at timestamptz,
  is_assigned_to_me boolean,
  can_manage boolean,
  assignees jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  perform public.cleanup_expired_department_tasks();

  if v_department_key is not null and not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  return query
  select
    task.id,
    task.department_key,
    department.name as department_name,
    task.created_by,
    coalesce(nullif(btrim(creator.display_name), ''), creator.position, 'Руководитель') as creator_name,
    task.task_date,
    task.due_at,
    task.text,
    task.created_at,
    exists (
      select 1
      from public.department_task_assignees mine
      where mine.task_id = task.id
        and mine.user_id = auth.uid()
    ) as is_assigned_to_me,
    public.can_edit_department(task.department_key) as can_manage,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', assignee.user_id,
          'display_name', coalesce(nullif(btrim(profile.display_name), ''), profile.position, 'Сотрудник'),
          'position', coalesce(profile.position, '')
        )
        order by coalesce(nullif(btrim(profile.display_name), ''), profile.position, assignee.user_id::text)
      )
      from public.department_task_assignees assignee
      left join public.profiles profile on profile.user_id = assignee.user_id
      where assignee.task_id = task.id
    ), '[]'::jsonb) as assignees
  from public.department_tasks task
  join public.departments department on department.key = task.department_key
  left join public.profiles creator on creator.user_id = task.created_by
  where (
    v_department_key is not null
    and task.department_key = v_department_key
    and public.can_edit_department(v_department_key)
  ) or (
    v_department_key is null
    and exists (
      select 1
      from public.department_task_assignees mine
      where mine.task_id = task.id
        and mine.user_id = auth.uid()
    )
  )
  order by
    case when task.due_at >= now() then 0 else 1 end,
    case when task.due_at >= now() then task.due_at end asc,
    case when task.due_at < now() then task.due_at end desc,
    task.created_at desc
  limit least(300, greatest(1, coalesce(p_limit, 100)));
end;
$$;

create or replace function public.delete_department_task(p_task_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_key text;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if p_task_id is null then
    raise exception 'TASK_ID_REQUIRED';
  end if;

  select task.department_key
  into v_department_key
  from public.department_tasks task
  where task.id = p_task_id;

  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  delete from public.user_notifications
  where department_key = v_department_key
    and type = 'department_task_assigned'
    and url = 'tasks.html?task=' || p_task_id;

  delete from public.department_tasks
  where id = p_task_id;
end;
$$;

revoke all on function public.create_department_task(text, date, timestamptz, text, text, uuid[]) from public;
revoke all on function public.list_my_department_tasks(text, integer) from public;
revoke all on function public.delete_department_task(bigint) from public;

grant execute on function public.create_department_task(text, date, timestamptz, text, text, uuid[]) to authenticated;
grant execute on function public.list_my_department_tasks(text, integer) to authenticated;
grant execute on function public.delete_department_task(bigint) to authenticated;

do $$
declare
  v_job_exists boolean := false;
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is unavailable; cleanup will run when the tasks page is opened';
  end;

  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    execute $query$
      select exists (
        select 1
        from cron.job
        where jobname = 'alvisa-cleanup-department-tasks'
      )
    $query$
    into v_job_exists;

    if not v_job_exists then
      perform cron.schedule(
        'alvisa-cleanup-department-tasks',
        '*/15 * * * *',
        'select public.cleanup_expired_department_tasks();'
      );
    end if;
  end if;
end;
$$;

commit;
