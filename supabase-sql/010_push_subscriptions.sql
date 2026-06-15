create extension if not exists pgcrypto;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_len check (char_length(endpoint) between 20 and 3000),
  constraint push_subscriptions_p256dh_len check (char_length(p256dh) between 20 and 500),
  constraint push_subscriptions_auth_len check (char_length(auth) between 8 and 500)
);

create unique index if not exists push_subscriptions_endpoint_uidx
on public.push_subscriptions (endpoint);

create index if not exists push_subscriptions_user_enabled_idx
on public.push_subscriptions (user_id, enabled, last_seen_at desc);

comment on table public.push_subscriptions is 'Web Push подписки браузеров пользователей для будущих уведомлений на телефон/компьютер.';
comment on column public.push_subscriptions.endpoint is 'Push endpoint из браузерной подписки.';
comment on column public.push_subscriptions.p256dh is 'Ключ p256dh из PushSubscription.keys.';
comment on column public.push_subscriptions.auth is 'Auth secret из PushSubscription.keys.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_push_subscriptions_updated'
      and tgrelid = 'public.push_subscriptions'::regclass
  ) then
    create trigger trg_push_subscriptions_updated
    before update on public.push_subscriptions
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.push_subscriptions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and policyname = 'push_subscriptions_select_own'
  ) then
    create policy "push_subscriptions_select_own"
    on public.push_subscriptions
    for select
    to authenticated
    using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and policyname = 'push_subscriptions_insert_own'
  ) then
    create policy "push_subscriptions_insert_own"
    on public.push_subscriptions
    for insert
    to authenticated
    with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and policyname = 'push_subscriptions_update_own'
  ) then
    create policy "push_subscriptions_update_own"
    on public.push_subscriptions
    for update
    to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and policyname = 'push_subscriptions_delete_own'
  ) then
    create policy "push_subscriptions_delete_own"
    on public.push_subscriptions
    for delete
    to authenticated
    using (user_id = auth.uid());
  end if;
end $$;

grant select, insert, update, delete on public.push_subscriptions to authenticated;

create or replace function public.upsert_my_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null,
  p_platform text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  if nullif(btrim(p_endpoint), '') is null then
    raise exception 'ENDPOINT_REQUIRED';
  end if;

  if nullif(btrim(p_p256dh), '') is null or nullif(btrim(p_auth), '') is null then
    raise exception 'PUSH_KEYS_REQUIRED';
  end if;

  insert into public.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth,
    user_agent,
    platform,
    enabled,
    last_seen_at
  )
  values (
    auth.uid(),
    btrim(p_endpoint),
    btrim(p_p256dh),
    btrim(p_auth),
    nullif(left(btrim(coalesce(p_user_agent, '')), 600), ''),
    nullif(left(btrim(coalesce(p_platform, '')), 120), ''),
    true,
    now()
  )
  on conflict (endpoint) do update
  set
    user_id = auth.uid(),
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    platform = excluded.platform,
    enabled = true,
    last_seen_at = now(),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.disable_my_push_subscription(
  p_endpoint text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_SESSION';
  end if;

  update public.push_subscriptions
  set
    enabled = false,
    last_seen_at = now(),
    updated_at = now()
  where user_id = auth.uid()
    and endpoint = btrim(p_endpoint);
end;
$$;

revoke all on function public.upsert_my_push_subscription(text, text, text, text, text) from public;
revoke all on function public.disable_my_push_subscription(text) from public;

grant execute on function public.upsert_my_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.disable_my_push_subscription(text) to authenticated;
