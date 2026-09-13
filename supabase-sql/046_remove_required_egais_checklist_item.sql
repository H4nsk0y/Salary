-- Stop restoring the former mandatory EGAIS item on every checklist write.
-- Existing active and completed checklists are left unchanged.

begin;

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

drop function if exists public.ensure_required_shift_checklist_items(jsonb, text);

commit;
