create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.department_invites (
  id uuid primary key default gen_random_uuid(),
  department_key text not null references public.departments(key) on delete cascade,
  token text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses integer,
  used_count integer not null default 0,
  revoked_at timestamptz,
  constraint department_invites_token_len check (char_length(token) between 24 and 120),
  constraint department_invites_max_uses_check check (max_uses is null or max_uses > 0),
  constraint department_invites_used_count_check check (used_count >= 0)
);

create index if not exists department_invites_department_key_idx
on public.department_invites (department_key);

create index if not exists department_invites_active_idx
on public.department_invites (created_at desc)
where revoked_at is null;

alter table public.department_invites enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'department_invites'
      and policyname = 'department_invites_editor_select'
  ) then
    create policy "department_invites_editor_select"
    on public.department_invites
    for select
    to authenticated
    using (public.can_edit_department(department_key));
  end if;
end $$;

create or replace function public.owner_create_department_invite(
  p_department_key text,
  p_expires_in_days integer default 14,
  p_max_uses integer default null
)
returns table (
  token text,
  department_key text,
  department_name text,
  expires_at timestamptz,
  max_uses integer,
  used_count integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_department_key text := nullif(btrim(p_department_key), '');
  v_token text;
  v_expires_days integer := greatest(1, least(coalesce(p_expires_in_days, 14), 90));
  v_max_uses integer := case when coalesce(p_max_uses, 0) > 0 then least(p_max_uses, 500) else null end;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_department_key is null then
    raise exception 'DEPARTMENT_REQUIRED';
  end if;

  if not exists (select 1 from public.departments d where d.key = v_department_key) then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into public.department_invites (
    department_key,
    token,
    created_by,
    expires_at,
    max_uses
  )
  values (
    v_department_key,
    v_token,
    auth.uid(),
    now() + make_interval(days => v_expires_days),
    v_max_uses
  );

  return query
  select
    i.token,
    i.department_key,
    d.name as department_name,
    i.expires_at,
    i.max_uses,
    i.used_count,
    i.created_at
  from public.department_invites i
  join public.departments d on d.key = i.department_key
  where i.token = v_token;
end;
$$;

create or replace function public.owner_list_department_invites()
returns table (
  token text,
  department_key text,
  department_name text,
  created_at timestamptz,
  expires_at timestamptz,
  max_uses integer,
  used_count integer,
  revoked_at timestamptz,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  return query
  select
    i.token,
    i.department_key,
    d.name as department_name,
    i.created_at,
    i.expires_at,
    i.max_uses,
    i.used_count,
    i.revoked_at,
    (
      i.revoked_at is null
      and (i.expires_at is null or i.expires_at > now())
      and (i.max_uses is null or i.used_count < i.max_uses)
    ) as is_active
  from public.department_invites i
  join public.departments d on d.key = i.department_key
  where public.is_owner()
     or public.can_edit_department(i.department_key)
  order by
    (
      i.revoked_at is null
      and (i.expires_at is null or i.expires_at > now())
      and (i.max_uses is null or i.used_count < i.max_uses)
    ) desc,
    i.created_at desc
  limit 50;
end;
$$;

create or replace function public.owner_revoke_department_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(p_token), '');
  v_department_key text;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if v_token is null then
    raise exception 'INVITE_TOKEN_REQUIRED';
  end if;

  select i.department_key
  into v_department_key
  from public.department_invites i
  where i.token = v_token;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  if not public.can_edit_department(v_department_key) then
    raise exception 'ACCESS_DENIED';
  end if;

  update public.department_invites
  set revoked_at = coalesce(revoked_at, now())
  where token = v_token;
end;
$$;

revoke all on function public.owner_create_department_invite(text, integer, integer) from public;
revoke all on function public.owner_list_department_invites() from public;
revoke all on function public.owner_revoke_department_invite(text) from public;

grant execute on function public.owner_create_department_invite(text, integer, integer) to authenticated;
grant execute on function public.owner_list_department_invites() to authenticated;
grant execute on function public.owner_revoke_department_invite(text) to authenticated;
