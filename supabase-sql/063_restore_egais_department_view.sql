-- Restore the read-only department timesheet for ordinary EGAIS members.
-- Editing remains limited to owners and appointed department editors/leaders.

create or replace function public.can_view_egais_department_timesheet()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.is_owner()
      or exists (
        select 1
        from public.department_members dm
        where dm.user_id = auth.uid()
          and dm.department_key = 'egais'
      )
      or exists (
        select 1
        from public.department_editors de
        where de.user_id = auth.uid()
          and de.department_key = 'egais'
      )
    );
$$;

revoke all on function public.can_view_egais_department_timesheet() from public, anon;
grant execute on function public.can_view_egais_department_timesheet() to authenticated;

comment on function public.can_view_egais_department_timesheet() is
  'Allows owners, EGAIS editors and ordinary EGAIS members to open the payroll-free read-only department timesheet.';
