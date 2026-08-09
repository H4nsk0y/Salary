-- Security hardening for profiles, timesheets, notifications, push and avatars.
-- Run once in Supabase SQL Editor after reviewing the current backup.

begin;

-- Profiles: users may edit only business fields, never role/created_at.
alter table public.profiles enable row level security;

revoke insert, update, delete on table public.profiles from authenticated;

grant insert (
  user_id, oklad, gender, position, display_name, avatar_url, hide_money,
  money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number,
  branch, employment_date, egais_file_reminders_enabled, hide_calculator_nav,
  weekly_hours
) on table public.profiles to authenticated;

grant update (
  user_id, oklad, gender, position, display_name, avatar_url, hide_money,
  money_pin_hash, money_pin_salt, auto_collapse_table_panels, tab_number,
  branch, employment_date, egais_file_reminders_enabled, hide_calculator_nav,
  weekly_hours
) on table public.profiles to authenticated;

create or replace function public.validate_profile_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean := coalesce(public.is_owner(), false);
  v_avatar text := nullif(btrim(new.avatar_url), '');
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if new.user_id is distinct from auth.uid() and not v_is_owner then
        raise exception 'PROFILE_USER_ID_DENIED';
      end if;

      if not v_is_owner then
        new.role := 'user';
        new.created_at := now();
      end if;
    else
      if new.user_id is distinct from old.user_id then
        raise exception 'PROFILE_USER_ID_IMMUTABLE';
      end if;

      if new.role is distinct from old.role and not v_is_owner then
        raise exception 'PROFILE_ROLE_DENIED';
      end if;

      if new.created_at is distinct from old.created_at and not v_is_owner then
        raise exception 'PROFILE_CREATED_AT_IMMUTABLE';
      end if;
    end if;
  end if;

  new.display_name := nullif(btrim(new.display_name), '');
  new.position := nullif(btrim(new.position), '');
  new.tab_number := nullif(btrim(new.tab_number), '');
  new.branch := nullif(btrim(new.branch), '');
  new.avatar_url := v_avatar;

  if new.role not in ('user', 'owner') then
    raise exception 'INVALID_PROFILE_ROLE';
  end if;
  if new.display_name is not null and char_length(new.display_name) > 120 then
    raise exception 'DISPLAY_NAME_TOO_LONG';
  end if;
  if new.position is not null and char_length(new.position) > 80 then
    raise exception 'POSITION_TOO_LONG';
  end if;
  if new.tab_number is not null and char_length(new.tab_number) > 64 then
    raise exception 'TAB_NUMBER_TOO_LONG';
  end if;
  if new.gender is not null and new.gender not in ('male', 'female') then
    raise exception 'INVALID_GENDER';
  end if;
  if new.branch is not null and new.branch not in (
    'chateau_alvisa', 'alvisa_whisky', 'alvisa_beverage',
    'alvisa_whisky_distillery', 'kin_wine_cognac_factory'
  ) then
    raise exception 'INVALID_BRANCH';
  end if;
  if new.weekly_hours is not null and new.weekly_hours not in (35, 40) then
    raise exception 'INVALID_WEEKLY_HOURS';
  end if;
  if new.oklad is not null and (new.oklad < 0 or new.oklad > 1000000000) then
    raise exception 'INVALID_OKLAD';
  end if;
  if new.employment_date is not null
     and (new.employment_date < date '1950-01-01' or new.employment_date > current_date) then
    raise exception 'INVALID_EMPLOYMENT_DATE';
  end if;
  if new.avatar_url is not null and char_length(new.avatar_url) > 1024 then
    raise exception 'AVATAR_URL_TOO_LONG';
  end if;
  if new.avatar_url is not null
     and new.avatar_url not like (new.user_id::text || '/%')
     and new.avatar_url not like ('%/avatars/' || new.user_id::text || '/%') then
    raise exception 'INVALID_AVATAR_PATH';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_profile_write() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_validate_profile_write'
      and tgrelid = 'public.profiles'::regclass
      and not tgisinternal
  ) then
    create trigger trg_validate_profile_write
    before insert or update on public.profiles
    for each row execute function public.validate_profile_write();
  end if;
end $$;

-- Timesheets: reject malformed or oversized payloads even when DevTools bypasses the UI.
alter table public.timesheets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.timesheets'::regclass
      and conname = 'timesheets_period_check'
  ) then
    alter table public.timesheets
      add constraint timesheets_period_check
      check (year between 2000 and 2100 and month between 0 and 11) not valid;
  end if;
end $$;

create or replace function public.validate_timesheet_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_index integer;
  v_key text;
  v_raw text;
  v_day numeric;
  v_night numeric;
  v_actual jsonb;
  v_status text;
  v_element jsonb;
begin
  if new.payload is null or jsonb_typeof(new.payload) <> 'object' then
    raise exception 'INVALID_TIMESHEET_PAYLOAD';
  end if;
  if octet_length(new.payload::text) > 262144 then
    raise exception 'TIMESHEET_PAYLOAD_TOO_LARGE';
  end if;
  if new.year < 2000 or new.year > 2100 or new.month < 0 or new.month > 11 then
    raise exception 'INVALID_TIMESHEET_PERIOD';
  end if;

  v_days := extract(day from (make_date(new.year, new.month + 1, 1) + interval '1 month - 1 day'))::integer;

  if new.payload ? 'year' and (new.payload ->> 'year') !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PAYLOAD_YEAR';
  end if;
  if new.payload ? 'year' and (new.payload ->> 'year')::integer <> new.year then
    raise exception 'PAYLOAD_YEAR_MISMATCH';
  end if;
  if new.payload ? 'month' and (new.payload ->> 'month') !~ '^[0-9]{1,2}$' then
    raise exception 'INVALID_PAYLOAD_MONTH';
  end if;
  if new.payload ? 'month' and (new.payload ->> 'month')::integer <> new.month then
    raise exception 'PAYLOAD_MONTH_MISMATCH';
  end if;

  foreach v_key in array array[
    'dayHours', 'nightHours', 'leaveType', 'shiftComments',
    'isHoliday', 'isTransferredOff', 'isShortDay'
  ] loop
    if new.payload ? v_key then
      if jsonb_typeof(new.payload -> v_key) <> 'array'
         or jsonb_array_length(new.payload -> v_key) <> v_days then
        raise exception 'INVALID_TIMESHEET_ARRAY: %', v_key;
      end if;
    end if;
  end loop;

  for v_index in 0..v_days - 1 loop
    v_day := 0;
    v_night := 0;

    if new.payload ? 'dayHours' then
      v_raw := new.payload -> 'dayHours' ->> v_index;
      if v_raw is not null and btrim(v_raw) <> '' then
        if v_raw !~ '^[0-9]+([.][0-9]{1,2})?$' then
          raise exception 'INVALID_DAY_HOURS';
        end if;
        v_day := v_raw::numeric;
      end if;
    end if;

    if new.payload ? 'nightHours' then
      v_raw := new.payload -> 'nightHours' ->> v_index;
      if v_raw is not null and btrim(v_raw) <> '' then
        if v_raw !~ '^[0-9]+([.][0-9]{1,2})?$' then
          raise exception 'INVALID_NIGHT_HOURS';
        end if;
        v_night := v_raw::numeric;
      end if;
    end if;

    if v_day < 0 or v_night < 0 or v_day > 24 or v_night > 24 or v_day + v_night > 24 then
      raise exception 'DAILY_HOURS_LIMIT_EXCEEDED';
    end if;

    if new.payload ? 'leaveType' then
      v_raw := nullif(btrim(new.payload -> 'leaveType' ->> v_index), '');
      if v_raw is not null and v_raw not in (
        'vacation', 'vac_paid', 'vac_unpaid', 'vac_unpaid_required',
        'sick', 'edu_paid', 'edu_unpaid', 'not_employed', 'dismissed',
        'О', 'ОТ', 'ОД', 'ОЗ', 'Б', 'БЛ', 'У', 'УД', 'НТ', 'УВ'
      ) then
        raise exception 'INVALID_LEAVE_TYPE';
      end if;
    end if;

    if new.payload ? 'shiftComments' then
      v_element := new.payload -> 'shiftComments' -> v_index;
      if v_element is not null and jsonb_typeof(v_element) not in ('string', 'null') then
        raise exception 'INVALID_SHIFT_COMMENT';
      end if;
      if char_length(coalesce(new.payload -> 'shiftComments' ->> v_index, '')) > 500 then
        raise exception 'SHIFT_COMMENT_TOO_LONG';
      end if;
    end if;

    foreach v_key in array array['isHoliday', 'isTransferredOff', 'isShortDay'] loop
      if new.payload ? v_key then
        v_element := new.payload -> v_key -> v_index;
        if v_element is not null and jsonb_typeof(v_element) not in ('boolean', 'null') then
          raise exception 'INVALID_DAY_MARK: %', v_key;
        end if;
      end if;
    end loop;
  end loop;

  v_actual := new.payload #> '{paySummary,actual}';
  if v_actual is not null and jsonb_typeof(v_actual) <> 'null' then
    if jsonb_typeof(v_actual) <> 'object' then
      raise exception 'INVALID_ACTUAL_PAYLOAD';
    end if;

    foreach v_key in array array['net', 'advance', 'remaining', 'paidLeaveNet', 'paidLeaveTax'] loop
      v_raw := v_actual ->> v_key;
      if v_raw is not null and btrim(v_raw) <> '' then
        if v_raw !~ '^[0-9]+([.][0-9]{1,2})?$'
           or v_raw::numeric < 0
           or v_raw::numeric > 1000000000 then
          raise exception 'INVALID_ACTUAL_MONEY: %', v_key;
        end if;
      end if;
    end loop;
  end if;

  v_status := nullif(btrim(new.payload #>> '{paySummary,status}'), '');
  if v_status is not null and v_status not in ('draft', 'actual_confirmed', 'changed_after_confirm') then
    raise exception 'INVALID_PAY_SUMMARY_STATUS';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_timesheet_write() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_validate_timesheet_write'
      and tgrelid = 'public.timesheets'::regclass
      and not tgisinternal
  ) then
    create trigger trg_validate_timesheet_write
    before insert or update on public.timesheets
    for each row execute function public.validate_timesheet_write();
  end if;
end $$;

-- Notifications must navigate only inside the application.
create or replace function public.validate_notification_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.title := left(btrim(coalesce(new.title, '')), 160);
  new.body := left(btrim(coalesce(new.body, '')), 2000);
  new.url := nullif(btrim(new.url), '');

  if new.title = '' or new.body = '' then
    raise exception 'EMPTY_NOTIFICATION';
  end if;
  if new.url is not null and (
    char_length(new.url) > 500
    or new.url ~ '^[[:space:]]*//'
    or lower(new.url) ~ '^[[:space:]]*(javascript|data|vbscript):'
    or new.url ~ '^[a-zA-Z][a-zA-Z0-9+.-]*://'
  ) then
    raise exception 'INVALID_NOTIFICATION_URL';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_notification_write() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.user_notifications') is not null and not exists (
    select 1 from pg_trigger
    where tgname = 'trg_validate_notification_write'
      and tgrelid = to_regclass('public.user_notifications')
      and not tgisinternal
  ) then
    create trigger trg_validate_notification_write
    before insert or update on public.user_notifications
    for each row execute function public.validate_notification_write();
  end if;
end $$;

-- Push endpoints are outbound destinations; reject local/private targets.
create or replace function public.validate_push_subscription_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endpoint text := btrim(coalesce(new.endpoint, ''));
begin
  if v_endpoint !~ '^https://[^[:space:]]+$'
     or lower(v_endpoint) ~ '^https://(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[?::1\]?|[^/]+\.local)(:|/|$)'
     or lower(v_endpoint) ~ '^https://172\.(1[6-9]|2[0-9]|3[01])\.' then
    raise exception 'INVALID_PUSH_ENDPOINT';
  end if;
  if char_length(v_endpoint) > 3000
     or char_length(coalesce(new.p256dh, '')) not between 20 and 500
     or char_length(coalesce(new.auth, '')) not between 8 and 500 then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  new.endpoint := v_endpoint;
  return new;
end;
$$;

revoke all on function public.validate_push_subscription_write() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.push_subscriptions') is not null and not exists (
    select 1 from pg_trigger
    where tgname = 'trg_validate_push_subscription_write'
      and tgrelid = to_regclass('public.push_subscriptions')
      and not tgisinternal
  ) then
    create trigger trg_validate_push_subscription_write
    before insert or update on public.push_subscriptions
    for each row execute function public.validate_push_subscription_write();
  end if;
end $$;

-- Avatar bucket: server-side limits and owner-only writes.
update storage.buckets
set
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'avatars';

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_write_path_restriction'
  ) then
    create policy "avatars_write_path_restriction"
    on storage.objects as restrictive for insert to authenticated
    with check (
      bucket_id <> 'avatars'
      or (storage.foldername(name))[1] = auth.uid()::text
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_update_path_restriction'
  ) then
    create policy "avatars_update_path_restriction"
    on storage.objects as restrictive for update to authenticated
    using (
      bucket_id <> 'avatars'
      or (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
      bucket_id <> 'avatars'
      or (storage.foldername(name))[1] = auth.uid()::text
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_delete_path_restriction'
  ) then
    create policy "avatars_delete_path_restriction"
    on storage.objects as restrictive for delete to authenticated
    using (
      bucket_id <> 'avatars'
      or (storage.foldername(name))[1] = auth.uid()::text
    );
  end if;
end $$;

commit;
