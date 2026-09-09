# Android-приложение ALVISA SALARY

Мобильная версия построена на Capacitor. Обычный сайт и GitHub Pages продолжают использовать исходные HTML/JS-файлы из корня проекта, а Android получает отдельную сборку из `www`.

## Подготовка проекта

```powershell
npm install
npm run cap:sync
```

`cap:sync` обновляет CSS, собирает разрешенные веб-файлы в `www` и переносит их в Android-проект. SQL-миграции, тесты, документация и дампы базы в APK не копируются.

## Запуск Android Studio

```powershell
npm run cap:open:android
```

Для сборки нужны Android Studio и Android SDK API 36. На Windows можно собирать и выпускать Android-приложение. Для будущей iOS-сборки потребуется macOS и Xcode.

## Тестовый APK без Android Studio

После отправки изменений в GitHub откройте `Actions` -> `Android debug APK` -> `Run workflow`. Готовый файл появится в разделе `Artifacts` под именем `alvisa-salary-debug` и будет храниться 14 дней.

Это отладочная сборка для внутреннего тестирования. Перед распространением приложения потребуется создать и надежно сохранить отдельный release-ключ подписи.

## Текущие ограничения

- Сайт и Android используют один проект Supabase и одни учетные записи.
- Web Push внутри Android-оболочки отключен намеренно. Нативные уведомления нужно подключить через Firebase Cloud Messaging.
- После изменения HTML, JS или CSS перед запуском Android необходимо выполнять `npm run cap:sync`.
- Папка `www` является временной сборкой и не хранится в Git.
