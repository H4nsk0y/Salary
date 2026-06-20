# send-egais-file-reminders

Edge Function для двух ежедневных напоминаний сотрудникам отдела ЕГАИС:

- 13:00 по Москве — проверить, ушли ли суточные;
- 00:30 по Москве — проверить суточные на правильность.

Получатели должны одновременно:

- состоять в `department_members` с `department_key = 'egais'`;
- включить настройку `egais_file_reminders_enabled`;
- иметь активную push-подписку.

Перед использованием:

1. Убедиться, что VAPID secrets уже настроены.
2. Задеплоить функцию:

```powershell
supabase.cmd functions deploy send-egais-file-reminders
```

3. Выполнить `supabase-sql/013_egais_file_reminders.sql`.
