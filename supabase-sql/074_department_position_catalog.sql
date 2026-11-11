begin;

create table if not exists public.department_position_catalog (
  department_key text not null references public.departments(key),
  position_value text not null,
  label text not null,
  is_leader_position boolean not null default false,
  primary key (department_key, position_value)
);
create unique index if not exists department_position_catalog_label_uidx
  on public.department_position_catalog (department_key, lower(label));

insert into public.department_position_catalog (department_key, position_value, label, is_leader_position)
select d.key, seed.value, seed.label, seed.leader
from (values
  ('egais', 'egais_head', 'Руководитель отдела ЕГАИС', true),
  ('egais', 'egais_senior_operator', 'Старший оператор ЕГАИС', false),
  ('egais', 'egais_operator', 'Оператор ЕГАИС', false),
  ('warehouse', 'warehouse_head', 'Руководитель склада', true),
  ('warehouse', 'storekeeper', 'Кладовщик', false),
  ('warehouse', 'loader', 'Грузчик', false),
  ('warehouse', 'driver', 'Водитель', false),
  ('bottling', 'bottling_plant_head', 'Руководитель цеха розлива', true),
  ('bottling', 'shift_senior_master', 'Старший мастер смены', false),
  ('bottling', 'shift_master', 'Мастер смены', false),
  ('bottling', 'filling_line_operator', 'Оператор линии розлива', false),
  ('bottling', 'accountant', 'Учетчик', false),
  ('laboratory', 'laboratory_head', 'Руководитель лаборатории', true),
  ('laboratory', 'deputy_head_laboratory', 'Заместитель руководителя лаборатории', false),
  ('laboratory', 'entrance_control_engineer', 'Инженер входного контроля', false),
  ('laboratory', 'quality_control_engineer', 'Инженер контроля качества', false),
  ('laboratory', 'chemist', 'Химик', false),
  ('laboratory', 'microbiologist', 'Микробиолог', false),
  ('accounting', 'chief_accountant', 'Главный бухгалтер', true),
  ('accounting', 'deputy_chief_accountant', 'Заместитель главного бухгалтера', false),
  ('accounting', 'accountant_bookkeeping', 'Бухгалтер', false),
  ('operations', 'system_administrator', 'Системный администратор', false),
  ('operations', 'assistant_system_administrator', 'Помощник системного администратора', false),
  ('hr', 'hr_service_head', 'Руководитель службы персонала', true),
  ('hr', 'hr_specialist', 'Специалист по персоналу', false),
  ('administration', 'director', 'Директор', true),
  ('administration', 'assistant_director', 'Помощник директора', false),
  ('administration', 'procurement_specialist', 'Специалист по закупкам', false),
  ('technology', 'technology_accounting_specialist', 'Специалист по учету', false)
) seed(department_key, value, label, leader)
join public.departments d on d.key = seed.department_key
on conflict do nothing;

create table if not exists public.department_position_proposals (
  idea_id bigint primary key references public.project_ideas(id) on delete cascade,
  department_key text not null references public.departments(key),
  position_name text not null,
  approved_at timestamptz
);

alter table public.department_position_catalog enable row level security;
alter table public.department_position_proposals enable row level security;
revoke all on public.department_position_catalog, public.department_position_proposals from public, anon, authenticated;

create or replace function public._profile_position_department(p_user_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select m.department_key from public.department_members m where m.user_id = p_user_id
     order by m.department_key limit 1),
    (select e.department_key from public.department_editors e where e.user_id = p_user_id
     order by e.department_key limit 1)
  );
$$;

create or replace function public._profile_position_reserved(p_department text, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.department_editors e
    where e.department_key = p_department and e.is_leader and e.user_id <> p_user_id);
$$;

create or replace function public.get_profile_position_options(p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_department text;
  v_locked boolean;
  v_testing_own_profile boolean;
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  if v_user <> auth.uid() and not coalesce(public.is_owner(), false) then
    perform public._leader_users_department(v_user);
  end if;
  v_testing_own_profile := v_user = auth.uid() and coalesce(public.is_owner(), false);
  if not v_testing_own_profile then
    v_department := public._profile_position_department(v_user);
  end if;
  select exists (select 1 from public.user_profile_restrictions r
    where r.user_id = v_user and r.position_locked) into v_locked;
  return jsonb_build_object(
    'department_key', v_department,
    'locked', v_locked,
    'departments', coalesce((select jsonb_agg(jsonb_build_object('key', d.key, 'label', d.name) order by d.name)
      from public.departments d where v_department is null or d.key = v_department), '[]'::jsonb),
    'positions', coalesce((select jsonb_agg(jsonb_build_object(
      'value', c.position_value, 'label', c.label, 'department_key', c.department_key
    ) order by c.is_leader_position desc, c.label)
    from public.department_position_catalog c
    where (v_department is null or c.department_key = v_department)
      and (v_testing_own_profile
        or not (c.is_leader_position and public._profile_position_reserved(c.department_key, v_user)))), '[]'::jsonb)
  );
end;
$$;

create or replace function public.enforce_profile_position_catalog()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_previous text;
  v_department text;
  v_owner boolean := auth.uid() is not null and coalesce(public.is_owner(), false);
  v_reserved boolean;
begin
  -- Trusted migrations and administrative maintenance are not client requests.
  if auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated') then return new; end if;
  if auth.uid() is null then raise exception 'ACCESS_DENIED'; end if;

  if tg_op = 'UPDATE' then
    v_previous := old.position;
  else
    -- An upsert can insert with an omitted position before the UPDATE branch.
    if new.position is null then return new; end if;
    select p.position into v_previous from public.profiles p where p.user_id = new.user_id;
  end if;
  if new.position is not distinct from v_previous then return new; end if;

  if not v_owner and exists (select 1 from public.user_profile_restrictions r
    where r.user_id = new.user_id and r.position_locked) then
    raise exception 'POSITION_CHANGE_LOCKED';
  end if;
  v_department := public._profile_position_department(new.user_id);
  if new.position is null and (v_department is null or v_owner) then return new; end if;

  select c.is_leader_position and public._profile_position_reserved(c.department_key, new.user_id)
    into v_reserved
    from public.department_position_catalog c
    where c.position_value = new.position and (v_owner or v_department is null or c.department_key = v_department)
    order by (c.department_key = v_department) desc, c.is_leader_position desc
    limit 1;
  if not found then raise exception 'POSITION_NOT_ALLOWED'; end if;
  if v_reserved and not (v_owner and new.user_id = auth.uid()) then
    raise exception 'DEPARTMENT_LEADER_POSITION_RESERVED';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_profile_position_catalog_trigger on public.profiles;
create trigger enforce_profile_position_catalog_trigger before insert or update of position on public.profiles
for each row execute function public.enforce_profile_position_catalog();
-- The catalog trigger reserves leadership titles by department and preserves unchanged legacy values.
drop trigger if exists trg_protect_leader_position on public.profiles;

create or replace function public.audit_profile_position_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.position is distinct from old.position then
    insert into public.owner_audit_log (actor_user_id, target_user_id, action, details)
    values (auth.uid(), new.user_id, 'position_changed',
      jsonb_build_object('before', old.position, 'after', new.position));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_profile_position_change_trigger on public.profiles;
create trigger audit_profile_position_change_trigger after update of position on public.profiles
for each row execute function public.audit_profile_position_change();

-- Serialize a lock change against concurrent profile writes.
create or replace function public.owner_set_user_position_lock(p_user_id uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_position text; v_role text;
begin
  if auth.uid() is null or not coalesce(public.is_owner(), false) then raise exception 'ACCESS_DENIED'; end if;
  select nullif(btrim(p.position), ''), coalesce(p.role, 'user') into v_position, v_role
    from public.profiles p where p.user_id = p_user_id for no key update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_role = 'owner' then raise exception 'CANNOT_LOCK_OWNER'; end if;
  if coalesce(p_locked, false) and v_position is null then raise exception 'POSITION_REQUIRED'; end if;
  if coalesce(p_locked, false) then
    insert into public.user_profile_restrictions (user_id, position_locked, updated_at, updated_by)
      values (p_user_id, true, now(), auth.uid())
    on conflict (user_id) do update set position_locked = true, updated_at = now(), updated_by = auth.uid();
  else
    delete from public.user_profile_restrictions where user_id = p_user_id;
  end if;
  insert into public.owner_audit_log (actor_user_id, target_user_id, action, details)
    values (auth.uid(), p_user_id, case when coalesce(p_locked, false)
      then 'position_locked' else 'position_unlocked' end, jsonb_build_object('position', v_position));
end;
$$;

create or replace function public.submit_department_position_proposal(p_department_key text, p_position_name text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_department text;
  v_label text;
  v_name text := btrim(regexp_replace(coalesce(p_position_name, ''), '[[:space:]]+', ' ', 'g'));
  v_idea_id bigint;
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  v_department := public._profile_position_department(auth.uid());
  if v_department is not null and v_department is distinct from p_department_key
    and not coalesce(public.is_owner(), false) then
    raise exception 'POSITION_NOT_ALLOWED';
  end if;
  select d.name into v_label from public.departments d where d.key = p_department_key;
  if not found then raise exception 'INVALID_DEPARTMENT'; end if;
  if char_length(v_name) not between 2 and 80 or v_name ~ '[<>{}[:cntrl:]]'
    or v_name ~ '(^__|(^|_)head$)' then raise exception 'INVALID_POSITION_NAME'; end if;
  if exists (select 1 from public.department_position_catalog c
    where (c.department_key = p_department_key and lower(c.label) = lower(v_name))
      or (c.position_value <> c.label and lower(c.position_value) = lower(v_name))) then
    raise exception 'POSITION_ALREADY_AVAILABLE';
  end if;
  if exists (select 1 from public.department_position_proposals p
    join public.project_ideas i on i.id = p.idea_id
    where p.department_key = p_department_key and lower(p.position_name) = lower(v_name)
      and i.user_id = auth.uid() and i.status = 'new') then raise exception 'POSITION_PROPOSAL_PENDING'; end if;

  v_idea_id := public.submit_project_idea(format('Предлагаю добавить должность «%s» в отдел «%s».', v_name, v_label));
  insert into public.department_position_proposals (idea_id, department_key, position_name)
    values (v_idea_id, p_department_key, v_name);
  return v_idea_id;
end;
$$;

create or replace function public.owner_list_project_ideas_with_positions(p_status text default null)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not coalesce(public.is_owner(), false) then raise exception 'ACCESS_DENIED'; end if;
  return query
    select to_jsonb(i) || jsonb_build_object('position_proposal',
      case when p.idea_id is not null then jsonb_build_object(
        'department', d.name, 'name', p.position_name, 'approved', p.approved_at is not null
      ) end)
    from public.owner_list_project_ideas(p_status) i
    left join public.department_position_proposals p on p.idea_id = i.id
    left join public.departments d on d.key = p.department_key
    order by case i.status when 'new' then 1 when 'reviewed' then 2 else 3 end, i.created_at desc, i.id desc;
end;
$$;

create or replace function public.owner_approve_department_position(p_idea_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_proposal public.department_position_proposals%rowtype;
  v_author uuid;
begin
  if auth.uid() is null or not coalesce(public.is_owner(), false) then raise exception 'ACCESS_DENIED'; end if;
  select i.user_id into v_author from public.project_ideas i where i.id = p_idea_id for update;
  select * into v_proposal from public.department_position_proposals p where p.idea_id = p_idea_id;
  if not found then raise exception 'POSITION_PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.approved_at is not null then return; end if;
  insert into public.department_position_catalog (department_key, position_value, label)
    values (v_proposal.department_key, v_proposal.position_name, v_proposal.position_name)
  on conflict do nothing;
  update public.department_position_proposals set approved_at = now() where idea_id = p_idea_id;
  update public.project_ideas set status = 'reviewed', reviewed_at = now() where id = p_idea_id;
  insert into public.user_notifications (user_id, actor_user_id, type, title, body, url, expires_at)
    values (v_author, auth.uid(), 'project_idea_reviewed', 'Должность добавлена',
      format('Должность «%s» теперь можно выбрать в профиле.', v_proposal.position_name),
      'profile.html', now() + interval '7 days');
end;
$$;

revoke all on function public._profile_position_department(uuid), public._profile_position_reserved(text, uuid),
  public.enforce_profile_position_catalog(), public.audit_profile_position_change() from public, anon, authenticated;
revoke all on function public.get_profile_position_options(uuid), public.submit_department_position_proposal(text, text),
  public.owner_set_user_position_lock(uuid, boolean), public.owner_list_project_ideas_with_positions(text),
  public.owner_approve_department_position(bigint) from public, anon;
grant execute on function public.get_profile_position_options(uuid), public.submit_department_position_proposal(text, text),
  public.owner_set_user_position_lock(uuid, boolean), public.owner_list_project_ideas_with_positions(text),
  public.owner_approve_department_position(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;

select
  exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass
    and tgname = 'enforce_profile_position_catalog_trigger' and tgenabled in ('O', 'A')) as position_guard_installed,
  exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass
    and tgname = 'audit_profile_position_change_trigger' and tgenabled in ('O', 'A')) as position_audit_installed,
  not has_function_privilege('anon', 'public.get_profile_position_options(uuid)', 'execute') as anonymous_access_blocked,
  not has_any_column_privilege('authenticated', 'public.department_position_catalog', 'INSERT,UPDATE')
    and not has_table_privilege('authenticated', 'public.department_position_catalog', 'DELETE') as direct_catalog_writes_blocked;
