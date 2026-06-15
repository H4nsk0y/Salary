# send-push-notifications

Edge Function для отправки Web Push по строкам из `user_notifications`.

Перед деплоем:

1. Выполнить SQL:
   - `supabase-sql/010_push_subscriptions.sql`
   - `supabase-sql/011_push_delivery_state.sql`

2. Задать secrets в Supabase:

```bash
supabase secrets set VAPID_PUBLIC_KEY="..."
supabase secrets set VAPID_PRIVATE_KEY="..."
supabase secrets set VAPID_SUBJECT="mailto:your-email@example.com"
```

3. Задеплоить функцию:

```bash
supabase functions deploy send-push-notifications
```

Приватный VAPID-ключ не хранить в репозитории.
