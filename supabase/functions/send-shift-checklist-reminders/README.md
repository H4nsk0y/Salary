# send-shift-checklist-reminders

Защищенная Edge Function для личных напоминаний по активному чек-листу смены.

## Запуск

1. Выполнить `supabase-sql/032_shift_checklists.sql` в SQL Editor.
2. Убедиться, что уже настроены секреты `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` и `VAPID_SUBJECT`.
3. Развернуть функцию:

```powershell
supabase.cmd functions deploy send-shift-checklist-reminders
```

Cron из SQL вызывает функцию раз в 15 минут. Пользователь получает напоминание не чаще одного раза в три часа и только при активной push-подписке.
