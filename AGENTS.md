# AGENTS.md

Рабочий контекст для Codex и других агентов, которые вносят изменения в проект Alvisa.

## Проект

Alvisa - статическое фронтенд-приложение для сотрудников и руководителей отдела.

Основные сценарии:
- welcome-страница: `index.html`
- калькулятор зарплаты: `calculator.html` + `app.js`
- личный табель: `table.html` + `table.js`
- личный кабинет: `profile.html` + `profile.js`
- вход/регистрация/reset password: `login.html` + `login.js`
- чат отдела: `chat.html` + `chat.js` (временно скрыт из навигации)
- owner-панель отделов: `owner.html` + `owner.js`
- общий табель отдела: `admin.html` + `admin.js`
- owner-центр пользователей: `owner-users.html` + `owner-users.js`
- owner-аналитика выплат: `owner-analytics.html` + `owner-analytics.js`
- общий верхний header/nav: `nav.js`

Стек:
- HTML
- Tailwind CSS через CDN
- vanilla JavaScript, ES modules
- Supabase JS client
- Supabase Auth
- Supabase Postgres / RPC / Realtime
- без React, без сборщика, без TypeScript

## Как работать с кодом

- Работать прямо в папке проекта, не создавать копии проекта на другом диске.
- Изменения делать точечно и совместимо с текущей архитектурой.
- Не ломать существующие `id` DOM-элементов, навигацию и структуру сохраненных данных без крайней необходимости.
- Общие запросы к Supabase добавлять в `db.js`, а не размазывать по page scripts.
- Общую логику выносить в отдельные небольшие ES modules только если она реально используется на нескольких страницах.
- Для SQL давать готовый скрипт в ответе. Пользователь сам запускает его в Supabase SQL Editor.
- SQL-скрипты сохранять в `supabase-sql/`, чтобы пользователь мог копировать их оттуда и чтобы история БД-изменений оставалась в репозитории.
- Предпочитать idempotent SQL: `create table if not exists`, `create index if not exists`, `create or replace function`, `do $$ begin ... end $$`.
- Не использовать `drop` в SQL без явной причины: Supabase показывает предупреждения о destructive operations.

## UI / UX

Сохранять текущий визуальный язык:
- темный glassmorphism
- `glass-card`
- `rounded-2xl`, `rounded-3xl`
- полупрозрачные темные блоки
- мягкие hover-эффекты
- pills/badges для статусов
- цвета в духе `text-slate-*`, `text-indigo-*`, `text-sky-*`

Не делать:
- светлую тему
- Bootstrap-like админку
- резкие контрастные блоки
- React-style переписывание интерфейса
- большие рефакторинги ради маленьких задач

Верхняя шапка вынесена в `nav.js`.

Для страниц с общей шапкой в HTML должен быть placeholder:

```html
<div data-app-header data-active="table"></div>
<script type="module" src="./nav.js"></script>
```

Для owner-страниц, где нужны пункты "Отделы" и "Онлайн":

```html
<div data-app-header data-active="owner" data-owner-nav="true"></div>
```

Новые пункты верхнего меню добавлять в `nav.js`, а не вручную в каждую HTML-страницу.

Чат отдела сейчас считается замороженной функцией: `chat.html`, `chat.js`, `department_messages` и Realtime-логику не удалять без отдельного решения, но пункт "Чат" не показывать в общей навигации и не развивать эту часть без явной просьбы.

## Авторизация и роли

Авторизация через Supabase Auth.

Основные helper-функции:
- `auth.js`: `getSession`, `requireSession`, `signUp`, `signIn`, `signOut`, `verifyCurrentPassword`, `requestPasswordReset`, `updateMyPassword`
- `db.js`: `getMyProfile`, `updateMyProfile`, `updateMyProfileFields`, функции табелей, отделов, чата и owner-RPC

Роли:
- `user` - обычный сотрудник
- `owner` - владелец системы, значение в `profiles.role`
- department editor - отдельная сущность в `department_editors`, не значение `profiles.role`

Owner-страницы должны проверять:
1. `requireSession()`
2. `getMyProfile()`
3. `profile.role === "owner"`

Редактор отдела может управлять конкретным общим табелем, но не всей системой.

## База данных Supabase

Важные таблицы:

`profiles`
- `user_id uuid not null`
- `role text not null`
- `oklad numeric`
- `created_at timestamptz not null`
- `display_name text`
- `avatar_url text`
- `gender text`
- `position text`
- `hide_money boolean not null`
- `money_pin_hash text`
- `money_pin_salt text`
- `auto_collapse_table_panels boolean not null`
- `tab_number text`
- `branch text`
- `employment_date date`

`timesheets`
- личные табели
- ключевая уникальность: `user_id, year, month`
- важное поле: `payload`
- нельзя ломать старую структуру `payload`

`departments`
- `key text not null`
- `name text not null`
- `created_at timestamptz not null`

`department_members`
- `department_key text not null`
- `user_id uuid not null`
- `created_at timestamptz not null`

`department_editors`
- `department_key text not null`
- `user_id uuid not null`
- `created_at timestamptz not null`

`department_messages`
- сообщения чата отдела
- используется Realtime-подписка по `department_key`

`user_notifications`
- личные уведомления пользователей
- `expires_at` скрывает уведомления спустя неделю
- пользователь видит и удаляет только свои уведомления
- уведомления отдела отправляются через RPC, а не прямыми insert с клиента

`user_presence`
- heartbeat пользователей для owner-страницы онлайн
- ожидаемые поля: `user_id`, `last_seen`, `page`, `updated_at`
- онлайн считается по `last_seen > now() - interval '2 minutes'`

Существующие DB helper-функции/политики, которые уже используются:
- `is_owner()`
- `can_edit_department(department_key)`
- `can_view_profile(user_id)`

Существующие owner RPC:
- `owner_list_department_members(p_department_key text)`
- `owner_list_available_profiles(p_department_key text)`
- `owner_add_department_member(p_department_key text, p_user_id uuid)`
- `owner_remove_department_member(p_department_key text, p_user_id uuid)`
- `owner_list_department_editors(p_department_key text)`
- `owner_add_department_editor(p_department_key text, p_user_id uuid)`
- `owner_remove_department_editor(p_department_key text, p_user_id uuid)`
- `owner_list_users()`
- `owner_set_user_department(p_user_id uuid, p_department_key text default null)`
- `owner_set_department_editor(p_department_key text, p_user_id uuid, p_is_editor boolean)`
- `owner_list_payroll_analytics(p_year integer default null, p_department_key text default null)`
- `notify_department_timesheet_saved(p_department_key text, p_year integer, p_month integer)`

Новые owner-специфичные операции лучше делать через `security definer` RPC в стиле уже существующих функций.

В SQL аккуратно обращаться с именем `position`: в `returns table` лучше писать `"position" text`, потому что без кавычек возможны ошибки парсинга.

## Расчеты зарплаты и табеля

Главная формула: `calc.js`.

Константы:
- `BONUS_RATE = 0.35`
- `TAX_RATE = 0.13`
- `NIGHT_EXTRA_RATE = 0.4`

Бизнес-правила:
- оклад делится на норму часов
- премия 35%
- ночные дают +40% к базовой часовой ставке
- налог 13%
- праздники считаются отдельно как двойная оплата
- вредность для грузчика: +4%
- стандартная дневная норма: 8 часов
- женская дневная норма 7.2 применяется только для филиала `chateau_alvisa` / CHATEAU ALVISA; во всех остальных филиалах используется стандартная 40-часовая неделя
- лимит переработки за год: 120 часов
- если есть сохраненный `moneySnapshot`, он приоритетнее текущего оклада
- подтвержденные фактические суммы важнее авторасчета в годовых итогах

Коды табеля:
- `ОТ` - оплачиваемый отпуск
- `ОД` - отпуск без оплаты
- `ОЗ` - обязательный отпуск без оплаты
- `Б` - больничный
- `У` - учебный отпуск
- `УД` - учебный отпуск без оплаты
- `НТ` - не трудоустроен в этот день; уменьшает личную норму на норму конкретного рабочего дня, но не относится к оплачиваемым отсутствиям

Обязательные поля профиля для доступа к табелю:
- `display_name`
- `position`
- `gender`
- `oklad`

## Деньги и приватность

Денежные данные могут скрываться PIN-защитой.

Связанные поля:
- `profiles.hide_money`
- `profiles.money_pin_hash`
- `profiles.money_pin_salt`

Связанные файлы:
- `moneyPrivacy.js`
- `profile.js`
- `table.js`
- `app.js`
- `settings.js`

При изменениях не обходить PIN-логику и не показывать оклад/выплаты там, где они должны быть скрыты.

## Presence / онлайн пользователи

Файлы:
- `presence.js`
- `owner-users.html`
- `owner-users.js`
- `db.js`: `upsertMyPresence`, `ownerListUsers`

Отдельной owner-страницы только для онлайн-пользователей больше нет. Онлайн-фильтр находится в owner-центре пользователей.

Heartbeat вызывается на основных страницах после проверки сессии:
- `calculator.html` / `app.js`
- `profile.html` / `profile.js`
- `table.html` / `table.js`
- `chat.html` / `chat.js`
- `settings.html` / `settings.js`
- `admin.html` / `admin.js`
- `owner.html` / `owner.js`
- `owner-users.html` / `owner-users.js`
- `owner-analytics.html` / `owner-analytics.js`

Ошибки heartbeat не должны ломать страницу: если таблица/RPC еще не созданы или сессии нет, страница должна продолжать работать.

## Журнал обновлений

Файл: `updates.html`.

Если пользователь после крупных изменений просит обновить журнал изменений, добавлять информацию в блок "Что уже добавлено":

```html
<div class="mt-4 grid gap-3 text-sm text-slate-300/90 leading-6">
```

Добавлять только пользовательски значимые изменения: новые возможности, изменения поведения, UX, безопасность, табель, профиль, чат, калькулятор. Не описывать внутренние технические работы, которые пользователю не важны, например мелкие правки owner/admin-логики, рефакторинг, перенос кода или SQL-служебку без видимого эффекта.

Текст писать простым русским языком в стиле существующих пунктов:

```html
<div>• Добавлена возможность ...</div>
```

Если изменение касается только owner/admin и обычным сотрудникам знать об этом не нужно, не добавлять его в `updates.html`, если пользователь явно не попросил.

## Проверка изменений

Для JS-файлов:
- `node --check file.js`

Для diff:
- `git diff --check`
- `git status --short`

Если пользователь просит "комить", "commit", "пуш" или "push" без дополнительных условий, выполнять стандартную схему из корня проекта:

```powershell
git add .
git commit -m "Короткое сообщение по смыслу изменений"
git push
```

Если пользователь явно указал текст коммита, использовать его. Если текст не указан, выбрать короткое русское сообщение по сути внесенных изменений.

Проект можно открывать через Visual Studio Live Server. Для быстрой локальной проверки можно поднять простой сервер из корня проекта:

```powershell
python -m http.server 5501 --bind 127.0.0.1
```

Не открывать ES modules напрямую через `file://`, лучше использовать локальный сервер.
