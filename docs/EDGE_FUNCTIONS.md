# Supabase Edge Functions

Краткая памятка по серверным функциям ALVISA SALARY. Исходный код находится в `supabase/functions/`, а связанные миграции - в `supabase-sql/`.

## Общие требования

- Приватные ключи и `CRON_SECRET` хранятся только в Supabase Secrets или Vault.
- Клиентский код содержит только публичный VAPID-ключ.
- После изменения функции ее нужно повторно развернуть: `supabase.cmd functions deploy <имя>`.
- Плановые функции принимают запросы только с корректным `CRON_SECRET`.

Для push-уведомлений нужны секреты:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

## Функции

### `send-push-notifications`

Отправляет Web Push по строкам из `user_notifications`, включая сообщения руководителю и редакторам о том, что сотрудник не сможет выйти на смену. Базовые миграции: `010_push_subscriptions.sql`, `011_push_delivery_state.sql`; для уведомлений об отказе от смены также нужна `053_shift_unavailable_reports.sql`.

Тип `owner_login` доставляет владельцу предупреждения о новой Auth-сессии.
Создание сообщений и минутный cron находятся в `067_owner_login_notifications.sql`.
Тип доступен только владельцу или cron с корректным `CRON_SECRET`; клиент не
передаёт получателей. `CRON_SECRET` должен совпадать с Vault-секретом
`alvisa_egais_cron_secret`. После изменения нужно повторно развернуть функцию.

### `send-egais-file-reminders`

Отправляет сотрудникам ЕГАИС напоминания о суточных файлах только при подходящей смене, включенной настройке и активной push-подписке. Защита cron настраивается миграцией `028_secure_egais_cron.sql`; значение `CRON_SECRET` должно совпадать с секретом в Vault `alvisa_egais_cron_secret`.

### `send-shift-checklist-reminders`

Напоминает о незавершенном активном чек-листе не чаще одного раза в три часа. Использует миграцию `032_shift_checklists.sql`; cron запускает проверку раз в 15 минут.

### `send-shift-reminders`

Предупреждает о ближайшей смене и напоминает заполнить чек-лист. Расписание и защита планового вызова находятся в `045_upcoming_shift_reminders.sql` и последующих миграциях этой функции.

Миграция `070_shift_start_checklist_reminders.sql` добавляет напоминание «Заполните чек-лист на смену, чтобы ничего не забыть!» в 08:05 для дневных и в 20:05 для ночных смен (Москва). Подтверждённые руководители (`department_editors.is_leader`) исключены. Отсыпные и коды отсутствия не считаются выходом на смену. Требуется активная push-подписка; ссылка ведёт в чек-лист. Развернуть обновлённую функцию до запуска миграции.

Подтверждённые руководители также исключены из напоминаний о ближайшей смене в 17:00. Для обновления правила повторно развернуть `send-shift-reminders`; расписание менять не нужно.

### `owner-account-admin`

Выполняет owner-only действия, которым нужен service-role: восстановление пароля, завершение сессий, блокировку и удаление аккаунта. Функция повторно проверяет роль владельца на сервере, не выполняет разрушительные действия над owner-аккаунтом и ограничивает адрес восстановления разрешенными origin.

## Развертывание

```powershell
supabase.cmd functions deploy send-push-notifications
supabase.cmd functions deploy send-egais-file-reminders
supabase.cmd functions deploy send-shift-checklist-reminders
supabase.cmd functions deploy send-shift-reminders
supabase.cmd functions deploy owner-account-admin
```

После развертывания проверить функции вручную безопасным тестовым вызовом и убедиться, что секреты не попали в Git, логи браузера или клиентский JavaScript.
