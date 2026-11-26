-- Named variants are separate from live timesheets and expire at Moscow month-end.
begin;
create table if not exists public.department_timesheet_snapshots (
  id uuid primary key default gen_random_uuid(),
  department_key text not null references public.departments(key) on delete cascade,
  scope text not null check (scope in ('chateau', 'odyssey')),
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 0 and 11),
  name text not null check (length(btrim(name)) between 1 and 100),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2097152),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz generated always as
    ((make_date(year, month + 1, 1) + interval '1 month') at time zone 'Europe/Moscow') stored
);
create index if not exists department_timesheet_snapshots_period
  on public.department_timesheet_snapshots (department_key, scope, year, month, created_at desc);
alter table public.department_timesheet_snapshots enable row level security;
revoke all on table public.department_timesheet_snapshots from public, anon, authenticated;
grant select, insert, delete on table public.department_timesheet_snapshots to authenticated;
drop policy if exists snapshot_read on public.department_timesheet_snapshots;
create policy snapshot_read on public.department_timesheet_snapshots for select to authenticated
  using (public.can_edit_department(department_key) and expires_at > now());
drop policy if exists snapshot_create on public.department_timesheet_snapshots;
create policy snapshot_create on public.department_timesheet_snapshots for insert to authenticated
  with check (public.can_edit_department(department_key) and created_by = auth.uid() and expires_at > now());
drop policy if exists snapshot_delete on public.department_timesheet_snapshots;
create policy snapshot_delete on public.department_timesheet_snapshots for delete to authenticated
  using (public.can_edit_department(department_key));

-- Bound storage even if clients keep sending duplicate variants in parallel.
create or replace function public.limit_department_timesheet_snapshots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.department_key || ':' || new.scope || ':' || new.year || ':' || new.month, 0));
  delete from public.department_timesheet_snapshots where expires_at <= now();
  if (select count(*) from public.department_timesheet_snapshots s where s.department_key = new.department_key
    and s.scope = new.scope and s.year = new.year and s.month = new.month) >= 30 then
    raise exception 'SNAPSHOT_LIMIT_REACHED';
  end if;
  return new;
end $$;
revoke all on function public.limit_department_timesheet_snapshots() from public, anon, authenticated;
drop trigger if exists department_timesheet_snapshot_limit on public.department_timesheet_snapshots;
create trigger department_timesheet_snapshot_limit before insert on public.department_timesheet_snapshots
  for each row execute function public.limit_department_timesheet_snapshots();
do $$
declare v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname = 'alvisa-timesheet-snapshot-cleanup'
  loop perform cron.unschedule(v_job); end loop;
end $$;
select cron.schedule('alvisa-timesheet-snapshot-cleanup', '0 21 * * *',
  'delete from public.department_timesheet_snapshots where expires_at <= now()');
commit;
