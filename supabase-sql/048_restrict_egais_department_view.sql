-- Temporarily limit the EGAIS department-wide read-only table to owners and
-- explicitly appointed department editors/leaders. Ordinary members keep
-- access to their own timesheet only.

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
        from public.department_editors de
        where de.user_id = auth.uid()
          and de.department_key = 'egais'
      )
    );
$$;

revoke all on function public.can_view_egais_department_timesheet() from public, anon;
grant execute on function public.can_view_egais_department_timesheet() to authenticated;
