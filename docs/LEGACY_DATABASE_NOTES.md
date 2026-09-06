# Legacy Database Notes

Безопасная выжимка из старых SQL-запросов. Это не скрипт для запуска, а контекст для будущих изменений БД.

## Важная оговорка

Старые запросы содержали конкретные `user_id` сотрудников и owner-аккаунта. Не сохранять такие UUID в репозиторий без явной просьбы пользователя.

Старые запросы также часто использовали `drop policy` / `drop trigger`. Для новых изменений лучше писать idempotent SQL без `drop`, если нет явной необходимости.

## История схемы

Базовые таблицы:
- `profiles`: профиль пользователя, роль, оклад, имя, аватар, пол, должность, настройки приватности денег, табельный номер.
- `timesheets`: личные табели, одна запись на `user_id + year + month`, данные в `payload jsonb`.
- `departments`: справочник отделов.
- `department_members`: состав отделов.
- `department_editors`: редакторы табелей отделов.
- `department_messages`: чат отдела.
- `user_presence`: heartbeat пользователей для owner-страницы онлайн.

Важные поля, добавленные позже:
- `profiles.display_name`
- `profiles.avatar_url`
- `profiles.gender`
- `profiles.position`
- `profiles.hide_money`
- `profiles.money_pin_hash`
- `profiles.money_pin_salt`
- `profiles.auto_collapse_table_panels`
- `profiles.tab_number`

## История доступа

Раньше использовалась роль `admin`, затем модель была переведена на:
- `profiles.role = 'owner'` для владельца системы;
- `department_editors` для редакторов конкретных отделов;
- обычные сотрудники остаются `profiles.role = 'user'`.

Не возвращать новую логику к `role = 'admin'` без отдельного решения.

## Helper-функции

Используются helper-функции:
- `is_owner()`
- `can_edit_department(department_key)`
- `can_view_profile(user_id)`
- `can_manage_timesheet(user_id)`

Для owner/editor-операций предпочтительны `security definer` RPC.

## Owner RPC

Существующая группа RPC для управления отделами:
- `owner_list_department_members`
- `owner_list_available_profiles`
- `owner_add_department_member`
- `owner_remove_department_member`
- `owner_list_department_editors`
- `owner_add_department_editor`
- `owner_remove_department_editor`
- `owner_list_online_users`

Эти функции должны проверять сессию и права через `is_owner()` / `can_edit_department(...)`.

## Storage / avatars

Для `storage.objects` были политики на bucket `avatars`.

Финальная идея доступа:
- пользователь может управлять своими файлами в папке своего `auth.uid()`;
- чтение аватаров может быть доступно всем authenticated-пользователям, если это требуется интерфейсу.

Перед изменением storage-политик сначала проверить текущие политики в Supabase.

## Chat

`department_messages`:
- сообщение принадлежит `department_key` и `user_id`;
- текст ограничен примерно 1..2000 символов;
- чтение и вставка разрешены участникам/редакторам своего отдела;
- редактирование/удаление было ограничено своими сообщениями и коротким окном времени;
- таблица добавлялась в `supabase_realtime`.

Перед изменениями чата учитывать `deleted_at`: в приложении используется soft delete.

## Практика для новых SQL

Новые SQL-файлы добавлять в `supabase-sql/` отдельными файлами:
- не вставлять реальные UUID сотрудников без необходимости;
- предпочитать `create table if not exists`;
- предпочитать `create index if not exists`;
- для policy использовать `do $$ ... if not exists ... create policy ... end $$`;
- для RPC использовать `create or replace function`;
- после RPC делать `revoke all ... from public` и `grant execute ... to authenticated`.
