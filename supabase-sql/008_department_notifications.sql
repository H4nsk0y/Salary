create table if not exists public.user_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  department_key text references public.departments(key) on delete cascade,
  type text not null default 'info',
  title text not null,
  body text not null,
  url text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists user_notifications_user_created_idx
on public.user_notifications (user_id, created_at desc);

create index if not exists user_notifications_expires_idx
on public.user_notifications (expires_at);

alter table public.user_notifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_notifications'
      and policyname = 'user_notifications_select_own_active'
  ) then
    create policy "user_notifications_select_own_active"
    on public.user_notifications
    for select
    to authenticated
    using (
      user_id = auth.uid()
      and expires_at > now()
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_notifications'
      and policyname = 'user_notifications_delete_own'
  ) then
    create policy "user_notifications_delete_own"
    on public.user_notifications
    for delete
    to authenticated
    using (user_id = auth.uid());
  end if;
end $$;

grant select, delete on public.user_notifications to authenticated;

create or replace function public.notify_department_timesheet_saved(
  p_department_key text,
  p_year integer,
  p_month integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
  v_department_name text;
  v_actor_name text;
  v_month_label text;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_department_key is null then
    raise exception 'DEPARTMENT_REQUIRED';
  end if;

  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'INVALID_YEAR';
  end if;

  if p_month is null or p_month < 0 or p_month > 11 then
    raise exception 'INVALID_MONTH';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  select d.name
    into v_department_name
  from public.departments d
  where d.key = v_department_key;

  if v_department_name is null then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.position), ''), 'Сотрудник')
    into v_actor_name
  from public.profiles p
  where p.user_id = auth.uid();

  v_actor_name := coalesce(v_actor_name, 'Сотрудник');

  v_month_label := case p_month
    when 0 then 'январь'
    when 1 then 'февраль'
    when 2 then 'март'
    when 3 then 'апрель'
    when 4 then 'май'
    when 5 then 'июнь'
    when 6 then 'июль'
    when 7 then 'август'
    when 8 then 'сентябрь'
    when 9 then 'октябрь'
    when 10 then 'ноябрь'
    when 11 then 'декабрь'
    else 'месяц'
  end;

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
    dm.user_id,
    auth.uid(),
    v_department_key,
    'department_timesheet_saved',
    'Табель отдела обновлён',
    v_actor_name || ' внёс изменения в табель отдела «' || v_department_name || '» за ' || v_month_label || ' ' || p_year || '.',
    'table.html?year=' || p_year || '&month=' || p_month,
    now() + interval '7 days'
  from public.department_members dm
  where dm.department_key = v_department_key;
end;
$$;

revoke all on function public.notify_department_timesheet_saved(text, integer, integer) from public;
grant execute on function public.notify_department_timesheet_saved(text, integer, integer) to authenticated;
