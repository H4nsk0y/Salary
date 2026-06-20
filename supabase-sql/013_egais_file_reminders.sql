alter table public.profiles
add column if not exists egais_file_reminders_enabled boolean not null default false;

comment on column public.profiles.egais_file_reminders_enabled is
'Получать напоминания ЕГАИС о проверках суточных файлов.';

create table if not exists public.egais_file_reminder_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_date date not null,
  reminder_kind text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, reminder_date, reminder_kind),
  constraint egais_file_reminder_kind_check check (
    reminder_kind in ('departure_check', 'validation_check')
  )
);

create index if not exists egais_file_reminder_deliveries_date_idx
on public.egais_file_reminder_deliveries (reminder_date);

alter table public.egais_file_reminder_deliveries enable row level security;

revoke all on table public.egais_file_reminder_deliveries from anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'alvisa_egais_reminder_project_url'
  ) then
    perform vault.create_secret(
      'https://lwxrorxqikwlrbaxoygv.supabase.co',
      'alvisa_egais_reminder_project_url',
      'URL проекта для запуска напоминаний ЕГАИС'
    );
  end if;

  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'alvisa_egais_reminder_anon_key'
  ) then
    perform vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3eHJvcnhxaWt3bHJiYXhveWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NjkzMzksImV4cCI6MjA4ODA0NTMzOX0.vQ-4mKNgpToIIgbPpOWO-jz38lcVAKA2uYx5zzZUyg0',
      'alvisa_egais_reminder_anon_key',
      'Публичный ключ для запуска Edge Function через Cron'
    );
  end if;
end $$;

select cron.schedule(
  'alvisa-egais-departure-check',
  '0 10 * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'alvisa_egais_reminder_project_url'
    ) || '/functions/v1/send-egais-file-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alvisa_egais_reminder_anon_key'
      ),
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alvisa_egais_reminder_anon_key'
      )
    ),
    body := '{"kind":"departure_check"}'::jsonb
  ) as request_id;
  $cron$
);

select cron.schedule(
  'alvisa-egais-validation-check',
  '30 21 * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'alvisa_egais_reminder_project_url'
    ) || '/functions/v1/send-egais-file-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alvisa_egais_reminder_anon_key'
      ),
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alvisa_egais_reminder_anon_key'
      )
    ),
    body := '{"kind":"validation_check"}'::jsonb
  ) as request_id;
  $cron$
);
