-- Personal shift checklists with server-side three-hour push reminders.
-- Run in Supabase SQL Editor, then deploy send-shift-checklist-reminders.

begin;

create table if not exists public.shift_checklists (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  department_key text references public.departments(key) on delete set null,
  department_name text,
  items jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  reminders_enabled boolean not null default true,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  next_reminder_at timestamptz,
  completed_count integer,
  total_count integer,
  completion_percent integer,
  updated_at timestamptz not null default now(),
  constraint shift_checklists_status_check check (status in ('active', 'completed')),
  constraint shift_checklists_completion_check check (
    (status = 'active' and completed_at is null)
    or
    (status = 'completed' and completed_at is not null)
  ),
  constraint shift_checklists_counts_check check (
    completed_count is null
    or (
      completed_count >= 0
      and total_count >= completed_count
      and completion_percent between 0 and 100
    )
  )
);

create unique index if not exists shift_checklists_one_active_per_user_idx
on public.shift_checklists (user_id)
where status = 'active';

create index if not exists shift_checklists_due_reminders_idx
on public.shift_checklists (next_reminder_at)
where status = 'active' and reminders_enabled = true;

create index if not exists shift_checklists_user_history_idx
on public.shift_checklists (user_id, completed_at desc, started_at desc);

create index if not exists shift_checklists_department_history_idx
on public.shift_checklists (department_key, completed_at desc)
where status = 'completed';

comment on table public.shift_checklists is
  'Постоянная история личных чек-листов смен; завершенные записи не удаляются автоматически.';
comment on column public.shift_checklists.department_name is
  'Название отдела на момент начала смены, сохраненное для будущей статистики.';

alter table public.shift_checklists enable row level security;
revoke all on table public.shift_checklists from anon, authenticated;

create or replace function public.validate_shift_checklist_items(p_items jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_item jsonb;
  v_count integer;
  v_distinct_ids integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return false;
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 40 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item -> 'id') <> 'string'
      or char_length(btrim(v_item ->> 'id')) not between 1 and 100
      or jsonb_typeof(v_item -> 'text') <> 'string'
      or char_length(btrim(v_item ->> 'text')) not between 1 and 160
      or jsonb_typeof(v_item -> 'done') <> 'boolean'
      or coalesce(v_item ->> 'source', '') not in ('standard', 'custom') then
      return false;
    end if;
  end loop;

  select count(distinct value ->> 'id')
  into v_distinct_ids
  from jsonb_array_elements(p_items);

  return v_distinct_ids = v_count;
end;
$$;

revoke all on function public.validate_shift_checklist_items(jsonb) from public, anon, authenticated;

create or replace function public.validate_shift_checklist_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.validate_shift_checklist_items(new.items) then
    raise exception 'INVALID_CHECKLIST_ITEMS';
  end if;

  if new.status = 'active' then
    new.completed_at := null;
    new.completed_count := null;
    new.total_count := null;
    new.completion_percent := null;
  else
    new.reminders_enabled := false;
    new.next_reminder_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validate_shift_checklist_write() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_validate_shift_checklist_write'
      and tgrelid = 'public.shift_checklists'::regclass
      and not tgisinternal
  ) then
    create trigger trg_validate_shift_checklist_write
    before insert or update on public.shift_checklists
    for each row execute function public.validate_shift_checklist_write();
  end if;
end $$;

create or replace function public.get_my_shift_checklist_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'active', (
      select jsonb_build_object(
        'id', checklist.id,
        'department_key', checklist.department_key,
        'department_name', checklist.department_name,
        'items', checklist.items,
        'reminders_enabled', checklist.reminders_enabled,
        'started_at', checklist.started_at,
        'next_reminder_at', checklist.next_reminder_at,
        'updated_at', checklist.updated_at
      )
      from public.shift_checklists checklist
      where checklist.user_id = auth.uid()
        and checklist.status = 'active'
      order by checklist.started_at desc
      limit 1
    ),
    'latest_completed', (
      select jsonb_build_object(
        'id', checklist.id,
        'department_key', checklist.department_key,
        'department_name', checklist.department_name,
        'items', checklist.items,
        'started_at', checklist.started_at,
        'completed_at', checklist.completed_at,
        'completed_count', checklist.completed_count,
        'total_count', checklist.total_count,
        'completion_percent', checklist.completion_percent
      )
      from public.shift_checklists checklist
      where checklist.user_id = auth.uid()
        and checklist.status = 'completed'
      order by checklist.completed_at desc
      limit 1
    )
  )
  where auth.uid() is not null;
$$;

create or replace function public.start_my_shift_checklist(
  p_items jsonb,
  p_reminders_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_department_key text;
  v_department_name text;
  v_row public.shift_checklists%rowtype;
begin
  if v_user_id is null then
    raise exception 'NO_SESSION';
  end if;
  if not public.validate_shift_checklist_items(p_items) then
    raise exception 'INVALID_CHECKLIST_ITEMS';
  end if;
  if exists (
    select 1 from public.shift_checklists
    where user_id = v_user_id and status = 'active'
  ) then
    raise exception 'ACTIVE_CHECKLIST_EXISTS';
  end if;

  select source.department_key
  into v_department_key
  from (
    select member.department_key, member.created_at, 1 as priority
    from public.department_members member
    where member.user_id = v_user_id
    union all
    select editor.department_key, editor.created_at, 2 as priority
    from public.department_editors editor
    where editor.user_id = v_user_id
  ) source
  order by source.priority, source.created_at
  limit 1;

  select department.name
  into v_department_name
  from public.departments department
  where department.key = v_department_key;

  insert into public.shift_checklists (
    user_id,
    department_key,
    department_name,
    items,
    reminders_enabled,
    next_reminder_at
  )
  values (
    v_user_id,
    v_department_key,
    v_department_name,
    p_items,
    coalesce(p_reminders_enabled, true),
    case when coalesce(p_reminders_enabled, true) then now() + interval '3 hours' else null end
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'department_key', v_row.department_key,
    'department_name', v_row.department_name,
    'items', v_row.items,
    'reminders_enabled', v_row.reminders_enabled,
    'started_at', v_row.started_at,
    'next_reminder_at', v_row.next_reminder_at,
    'updated_at', v_row.updated_at
  );
exception
  when unique_violation then
    raise exception 'ACTIVE_CHECKLIST_EXISTS';
end;
$$;

create or replace function public.owner_shift_checklist_statistics(
  p_from date default null,
  p_to date default null
)
returns table (
  department_key text,
  department_name text,
  completed_shifts bigint,
  employees bigint,
  checklist_items bigint,
  completed_items bigint,
  average_completion_percent numeric
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
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  return query
  select
    checklist.department_key,
    coalesce(nullif(checklist.department_name, ''), department.name, 'Без отдела') as department_name,
    count(*)::bigint as completed_shifts,
    count(distinct checklist.user_id)::bigint as employees,
    coalesce(sum(checklist.total_count), 0)::bigint as checklist_items,
    coalesce(sum(checklist.completed_count), 0)::bigint as completed_items,
    round(avg(checklist.completion_percent), 1) as average_completion_percent
  from public.shift_checklists checklist
  left join public.departments department on department.key = checklist.department_key
  where checklist.status = 'completed'
    and (p_from is null or (checklist.completed_at at time zone 'Europe/Moscow')::date >= p_from)
    and (p_to is null or (checklist.completed_at at time zone 'Europe/Moscow')::date <= p_to)
  group by
    checklist.department_key,
    coalesce(nullif(checklist.department_name, ''), department.name, 'Без отдела')
  order by 3 desc, 2;
end;
$$;

create or replace function public.update_my_shift_checklist(
  p_checklist_id bigint,
  p_items jsonb,
  p_reminders_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.shift_checklists%rowtype;
  v_row public.shift_checklists%rowtype;
begin
  if v_user_id is null then
    raise exception 'NO_SESSION';
  end if;
  if not public.validate_shift_checklist_items(p_items) then
    raise exception 'INVALID_CHECKLIST_ITEMS';
  end if;

  select * into v_existing
  from public.shift_checklists
  where id = p_checklist_id
    and user_id = v_user_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'CHECKLIST_NOT_FOUND';
  end if;

  update public.shift_checklists
  set
    items = p_items,
    reminders_enabled = coalesce(p_reminders_enabled, false),
    next_reminder_at = case
      when not coalesce(p_reminders_enabled, false) then null
      when not v_existing.reminders_enabled or v_existing.next_reminder_at is null then now() + interval '3 hours'
      else v_existing.next_reminder_at
    end
  where id = p_checklist_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'items', v_row.items,
    'reminders_enabled', v_row.reminders_enabled,
    'started_at', v_row.started_at,
    'next_reminder_at', v_row.next_reminder_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.finish_my_shift_checklist(p_checklist_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.shift_checklists%rowtype;
  v_total integer;
  v_completed integer;
  v_percent integer;
begin
  if v_user_id is null then
    raise exception 'NO_SESSION';
  end if;

  select * into v_row
  from public.shift_checklists
  where id = p_checklist_id
    and user_id = v_user_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'CHECKLIST_NOT_FOUND';
  end if;

  select
    count(*)::integer,
    count(*) filter (where (entry.value ->> 'done')::boolean)::integer
  into v_total, v_completed
  from jsonb_array_elements(v_row.items) as entry(value);

  v_percent := case when v_total > 0 then round(v_completed * 100.0 / v_total)::integer else 0 end;

  update public.shift_checklists
  set
    status = 'completed',
    completed_at = now(),
    completed_count = v_completed,
    total_count = v_total,
    completion_percent = v_percent,
    reminders_enabled = false,
    next_reminder_at = null
  where id = p_checklist_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'department_key', v_row.department_key,
    'items', v_row.items,
    'started_at', v_row.started_at,
    'completed_at', v_row.completed_at,
    'completed_count', v_row.completed_count,
    'total_count', v_row.total_count,
    'completion_percent', v_row.completion_percent
  );
end;
$$;

revoke all on function public.get_my_shift_checklist_state() from public, anon;
revoke all on function public.start_my_shift_checklist(jsonb, boolean) from public, anon;
revoke all on function public.update_my_shift_checklist(bigint, jsonb, boolean) from public, anon;
revoke all on function public.finish_my_shift_checklist(bigint) from public, anon;
revoke all on function public.owner_shift_checklist_statistics(date, date) from public, anon;

grant execute on function public.get_my_shift_checklist_state() to authenticated;
grant execute on function public.start_my_shift_checklist(jsonb, boolean) to authenticated;
grant execute on function public.update_my_shift_checklist(bigint, jsonb, boolean) to authenticated;
grant execute on function public.finish_my_shift_checklist(bigint) to authenticated;
grant execute on function public.owner_shift_checklist_statistics(date, date) to authenticated;

commit;

-- Reuse the already configured protected cron URL, anon key and CRON_SECRET.
do $$
declare
  v_missing text;
begin
  select string_agg(required.name, ', ' order by required.name)
  into v_missing
  from (
    values
      ('alvisa_egais_cron_secret', 32),
      ('alvisa_egais_reminder_anon_key', 20),
      ('alvisa_egais_reminder_project_url', 12)
  ) as required(name, min_length)
  where not exists (
    select 1
    from vault.decrypted_secrets secret
    where secret.name = required.name
      and char_length(secret.decrypted_secret) >= required.min_length
  );

  if v_missing is not null then
    raise exception 'Required Vault secrets are missing: %', v_missing;
  end if;
end $$;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'alvisa-shift-checklist-reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

select cron.schedule(
  'alvisa-shift-checklist-reminders',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_project_url') || '/functions/v1/send-shift-checklist-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_reminder_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alvisa_egais_cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $cron$
);
