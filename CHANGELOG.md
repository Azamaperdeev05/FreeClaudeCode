# Changelog

## 1.3.0 — 2026-08-12

### База OmniRoute находится там, где она на самом деле лежит

- FreeClaude искал базу только в `%USERPROFILE%\.omniroute`. OmniRoute кладёт её туда
  лишь тогда, когда эта папка осталась от старых версий: при установке с нуля база
  уходит в `%APPDATA%\omniroute`, а при заданном `DATA_DIR` — куда указал пользователь.
  У кого не было старой папки, FreeClaude базу не видел — и разом отваливались статус
  Kiro, выдача ключа и лечение соединений. Отсюда жалобы «вход прошёл, а программа
  пишет, что не вошёл» и «у некоторых Kiro не активируется».
- Теперь путь вычисляется так же, как это делает сам OmniRoute, и перечитывается на
  каждом обращении — базу, созданную уже после старта FreeClaude, тоже видно.

### Проверка и починка уже стоявшего OmniRoute

Если OmniRoute стоял до FreeClaude, он мог остаться настроенным как угодно — и тогда
часть моделей просто не доходит до Claude Code без каких-либо сообщений. FreeClaude
теперь находит такие настройки и чинит их сам:

- модели, скрытые «глазом» в панели OmniRoute или спрятанные автотестом после сбоя;
- Kiro в чёрном списке провайдеров;
- включённое «скрывать платные модели», которое режет часть списка Kiro;
- кэш каталога моделей, оставшийся от удалённого аккаунта и перебивающий актуальный список;
- ограничения на API-ключе (`allowed_models`, `blocked_models`, «только публичные модели»),
  из-за которых Claude Code видит короткий список;
- аккаунт Kiro с рабочими токенами, но выключённый в OmniRoute;
- ключ от другой установки OmniRoute, отозванный или просроченный — выдаётся новый.

Проверка идёт молча при запуске и после входа в Kiro, а в «Настройках» есть кнопка
«Проверить и починить» с разбором находок. Чинится только то, что открывает доступ:
ни аккаунты, ни ключи, ни чужие настройки не удаляются. Блокировки других провайдеров,
если пользователь поставил их сам, остаются на месте.

Отдельно: OmniRoute держит настройки в памяти, поэтому после починки FreeClaude сбрасывает
его кэш — иначе исправления вступили бы в силу только через минуту.

Каталог моделей намеренно не пересинхронизируется: OmniRoute предпочитает
синхронизированный каталог встроенному, так что такая синхронизация скрыла бы больше
моделей, чем вернула.

## 1.2.0 — 2026-08-12

### Английский и русский язык

- Интерфейс переведён целиком: вкладки, карточки моделей, окно входа в Kiro, лог
  установки, тосты и текст ошибок. По умолчанию английский — пока пользователь сам не
  выберет русский.
- Переключатель в «Настройках» с флагами. Язык применяется сразу, без перезагрузки
  страницы: во время входа в Kiro его можно поменять, не потеряв код устройства.
- Выбор хранится в конфиге FreeClaude, поэтому переживает перезапуск и не зависит от
  того, чем пользователь открыл окно.
- Сообщения сервера тоже переведены — лог установки, ошибки путей и ответы API идут на
  выбранном языке, а не только надписи в браузере.
- Ошибки OmniRoute и Kiro теперь передаются кодом причины, а текст подставляется на
  стороне интерфейса. Сохранённые результаты проверки моделей перечитываются на новом
  языке, а не остаются на старом.
- Флаги нарисованы в SVG: Windows показывает эмодзи-флаги как буквы «RU», поэтому
  эмодзи здесь не годятся.

## 1.1.0 — 2026-08-12

### Пароль панели OmniRoute больше не блокирует вход

- Вход в Kiro упирался в «Неверный пароль панели OmniRoute» — и дальше пользователь
  сам должен был искать, какой там пароль. Теперь, если ни один известный пароль не
  подходит, FreeClaude задаёт новый через штатную утилиту OmniRoute
  (`omniroute-reset-password`), сохраняет его у себя и заходит сам. Экран с ошибкой
  человек больше не видит.
- Пароль ищется ещё и в `.env` самого пакета OmniRoute — именно там лежит
  `INITIAL_PASSWORD`, который раньше не проверялся.
- После сброса OmniRoute перезапускается: работающий сервер держит старый пароль в
  памяти, и без перезапуска новый не действует.

### Kiro теперь определяется правильно

- Статус аккаунта Kiro читался только из базы OmniRoute напрямую. Если этот путь не
  работал (нет Node в PATH, несовместимая сборка better-sqlite3, занятый файл),
  FreeClaude сообщал «вход не выполнен» сразу после успешного входа в AWS. Теперь при
  отказе базы статус спрашивается у самого OmniRoute по HTTP, и вход виден.
- `/api/quota` при недоступной базе больше не падает с ошибкой 500: аккаунт
  показывается активным, а вместо счётчиков пишется, что детали недоступны.
- Кнопка «Войти в Kiro» на время подготовки пишет «Подключаюсь…» — раньше при
  перезапуске OmniRoute она просто молча гасла на полминуты.

## 1.0.9 — 2026-08-12

### Вход в Kiro / AWS

- Вместо одного бесконечного спиннера окно входа показывает четыре шага: открываем окно
  AWS → подтверди код → подключаем Kiro → загружаем модели. Видно, на чём именно застряло,
  и шаг с ошибкой подсвечивается красным, а не молчит.
- Под кодом идёт живая строка состояния: сколько времени идёт вход и какая по счёту
  проверка ушла в AWS. Раньше при долгом ожидании было непонятно, работает ли что-нибудь.
- Код устройства можно скопировать кнопкой (с запасным способом — страница открыта по
  http, где буфер обмена браузера недоступен).
- Если окно AWS не открылось, это отмечается прямо на первом шаге, а опрос продолжается:
  код можно подтвердить в любом другом браузере.

### Оформление

- Иконки по всему интерфейсу — в меню, кнопках, карточках компонентов, плашке лимита и
  окне входа. Набор встроен в страницу, а не грузится из сети.
- Логотипы моделей больше не ломаются без интернета: сразу рисуется фирменный
  цветной значок, а картинка с CDN подменяет его, только если реально загрузилась.
- Главная страница дополнена карточками с описанием того, что делает программа.
- Поиск моделей получил иконку, компоненты в настройках — тематические значки с цветом по
  состоянию, режим персоны — свой значок.

## 1.0.8 — 2026-08-12

- Ошибки моделей больше не показываются английским текстом провайдера. Вместо
  `429 · All kiro accounts have exhausted their…` карточка пишет «Лимит Kiro исчерпан на
  всех аккаунтах», а во всплывающем сообщении сразу видно, что делать: подождать сброса
  или подключить другой аккаунт.
- Разбираются лимит, блокировка аккаунта, протухшая сессия Kiro, отсутствие аккаунта,
  неверный ключ, недоступная модель, слишком длинный запрос, перегрузка провайдера,
  отсутствие связи с OmniRoute и таймаут. Для остальных случаев показывается исходный
  текст, а не пустая «ошибка».
- Оригинальный ответ никуда не делся — он под подсказкой при наведении на ошибку, чтобы
  было что показать в поддержку.
- Лимит и блокировка теперь сразу обновляют состояние аккаунта, а не оставляют старую
  плашку.
- Запуск Claude Code больше не зашивает `%APPDATA%\npm`: используется тот же путь, что
  задан шестерёнкой.
- Добавлен `dev.bat` — запуск из исходников без сборки exe.

## 1.0.7 — 2026-08-12

### Установка

- Отсутствие winget больше не тупик. На машинах без App Installer (LTSC, Server, часть
  сборок Windows 10) установка упиралась в «winget не найден. Установи Node.js вручную» —
  теперь FreeClaude качает официальный архив с nodejs.org и распаковывает его в
  `%LOCALAPPDATA%\Programs\node`. Права администратора не нужны.
- Сам winget тоже ищется лучше: не только по псевдониму в `WindowsApps`, но и в PATH, и в
  папке пакета App Installer.
- Если winget есть, но после него Node.js так и не появился, установка не падает, а
  переходит на архив.
- После портативной установки в PATH пользователя добавляются папка Node.js и
  `%APPDATA%\npm`, чтобы `claude` и `omniroute` работали и в обычном терминале.

### Ручные пути

- У карточек Node.js, npm, OmniRoute и Claude Code появилась шестерёнка: можно указать
  путь самому, если программа компонент не видит. Принимается и файл, и папка с ним.
- Путь проверяется до сохранения: файл должен существовать, называться как надо, а для
  Node.js — ещё и запускаться, с версией не ниже 22.
- Заданный путь учитывается везде — при проверке, установке, запуске OmniRoute и в
  генерируемых .bat, включая нестандартный префикс npm.
- Карточка с ручным путём подсвечивается, шестерёнка позволяет сбросить его обратно.

## 1.0.6 — 2026-08-12

- Added an on/off switch for the persona mode in Настройки. Claude Code reads
  `~/.claude/CLAUDE.md` on every session, so the switch just puts that file in place or
  takes it away — requests are not touched and nothing is proxied.
- The persona text is copied into FreeClaude's data folder the first time the switch is
  used, so turning it off keeps the text and turning it back on restores it byte for byte,
  including any edits made while it was active.
- A `CLAUDE.md` that is not the persona is treated as your own memory file: it is set
  aside before the persona is written and put back when the persona is switched off.

## 1.0.5 — 2026-08-12

Fixes three regressions from 1.0.4.

- `ANTHROPIC_BASE_URL` is written to the Claude Code settings again. Removing the
  bypass proxy took it out with it, so running `claude` from a terminal sent the
  OmniRoute key to api.anthropic.com and every request came back as an API error.
  Launching from the app still worked because `omniroute launch` sets it itself,
  which is why this only showed up for people starting Claude Code by hand.
- Dropped the hard "Node.js 22+ required" refusal in the SQLite bridge. `better-sqlite3`
  declares that engine but its N-API addon loads on older runtimes, and refusing up
  front broke key and account lookups on Node 20 — the login succeeded while the UI
  kept saying no account was connected. The version is now only mentioned if the
  bridge actually fails.
- A successful Kiro login no longer repaints the UI as logged out. Issuing the key
  runs before the first status refresh, and its "войди в Kiro" guard was resetting
  the auth buttons.
- `is_active` missing from an OmniRoute `api_keys` schema no longer marks every key
  revoked, which made each call create another duplicate key.

## 1.0.4 — 2026-08-12

### Security

- Reject requests from other origins. The local server is reachable from any page in
  the browser, so `Origin`/`Host` are now checked to stop CSRF and DNS rebinding.
- Validate model ids and API keys against an allowlist before they reach the generated
  `.bat` files. Previously a value containing `&` could run arbitrary commands on launch.
- Broaden `.gitignore` to `_*` and drop scratch files that had held live AWS OAuth
  device codes, a client secret and a session cookie.

### Fixes

- Shutdown / orphan OmniRoute processes
  - Startup cleanup kills any leftover OmniRoute from previous runs before starting a new one
  - Added detached PowerShell watchdog that kills OmniRoute when FreeClaude window is closed
  - More aggressive shutdown: port 20128 listeners, node/omniroute processes, image-name fallbacks
- Dynamic SQLite queries for OmniRoute schema differences, now also for `listApiKeys`
  (no more `no such column: quota_visible`)
- The packaged exe resolves Node the same way the app does (nvm, Scoop, any drive)
  instead of assuming `C:\Program Files\nodejs`
- SQLite calls no longer hang the server: 20s timeout on the bridge, 10s busy timeout
  on the database, and a clear error when Node is older than 22
- `ensureApiKey` runs its lookup and insert in one transaction, so two quick calls
  cannot create duplicate keys
- A corrupt `localStorage` entry no longer leaves the UI blank on start
- Kiro login: failed polling now clears its own state instead of claiming the login
  continues in the background, and the login button stays disabled while polling

### UI

- "Удалить" button for the saved OmniRoute API key in Settings
- Escape closes the Kiro modal; toast and search are exposed to screen readers

### Performance

- The model grid no longer rebuilds on every 20s quota poll, which kept resetting
  scroll position and focus
- Quota polling pauses while the window is hidden, the countdown ticker only runs
  during an actual limit, and search input is debounced

### Build

- `build-release.ps1` fails on non-zero exit codes, resolves Node from PATH, closes a
  running exe before cleaning, pins `better-sqlite3`, uses `npm ci`, and verifies the
  output contains every required file
- Removed ~200 lines of dead CSS and the duplicated `formatDuration` that made quota
  text differ between dev and the packaged build

## 1.0.3 — 2026-08-12

- Fix: detect Node on other drives (e.g. `E:\Program Files\Nodejs`)
- Fix: OmniRoute login tries multiple passwords + clearer Russian error (no raw JSON)
- Fix: always kill OmniRoute / port 20128 on FreeClaude exit (fewer orphan processes / lag)
- Fix: more reliable CSS inlining + JS cache bust after updates
- Release ships both `.zip` and standalone `.exe`

## 1.0.2 — 2026-08-11

- Fix: detect Node.js / npm from full user PATH (nvm, scoop, custom installs) — not only `C:\Program Files\nodejs`

## 1.0.1 — 2026-08-11

- Fix: after AWS “Request approved”, auth no longer drops if the modal is closed
- Fix: wait for Kiro connection + models before showing an empty list
- Heal inactive Kiro provider rows that already have tokens

## 1.0.0 — 2026-08-11

- First public Windows portable build
- Local dashboard for setup, Kiro auth, and model launch
- OmniRoute integration and API key helpers
- README + release package for GitHub
