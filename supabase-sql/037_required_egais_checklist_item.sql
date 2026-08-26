-- Keep the EGAIS brand handover item in every active checklist, including writes
-- from an outdated or modified client.

begin;

create or replace function public.ensure_required_shift_checklist_items(
  p_items jsonb,
  p_department_key text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_item jsonb;
  v_result jsonb := '[]'::jsonb;
  v_normalized_text text;
  v_found boolean := false;
  v_required_text constant text := 'Покрутить марку сменщику';
begin
  if p_department_key is distinct from 'egais'
    or p_items is null
    or jsonb_typeof(p_items) <> 'array' then
    return p_items;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_normalized_text := lower(regexp_replace(btrim(coalesce(v_item ->> 'text', '')), '[[:space:]]+', ' ', 'g'));

    if v_normalized_text in (
      lower(v_required_text),
      lower('Покрутить марку для сменщика')
    ) then
      if not v_found then
        v_item := jsonb_set(v_item, '{text}', to_jsonb(v_required_text), true);
        v_item := jsonb_set(v_item, '{source}', '"standard"'::jsonb, true);
        v_result := v_result || jsonb_build_array(v_item);
        v_found := true;
      end if;
    else
      v_result := v_result || jsonb_build_array(v_item);
    end if;
  end loop;

  if not v_found then
    if jsonb_array_length(v_result) >= 40 then
      v_result := v_result - (jsonb_array_length(v_result) - 1);
    end if;

    v_result := jsonb_build_array(jsonb_build_object(
      'id', 'required-egais-brand-handover',
      'text', v_required_text,
      'done', false,
      'source', 'standard'
    )) || v_result;
  end if;

  return v_result;
end;
$$;

revoke all on function public.ensure_required_shift_checklist_items(jsonb, text)
from public, anon, authenticated;

create or replace function public.validate_shift_checklist_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.items := public.ensure_required_shift_checklist_items(new.items, new.department_key);

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

update public.shift_checklists
set items = public.ensure_required_shift_checklist_items(items, department_key)
where department_key = 'egais'
  and status = 'active';

commit;
