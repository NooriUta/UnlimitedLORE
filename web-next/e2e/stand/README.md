# Смоук v2 на стенде (E2E-STAND)

Задача: SPRINT_UXR_S11_TEST_OPT/E2E-STAND. Пять сценариев против живого стенда после выкатки в preprod, только чтение:

- S0 — какая сборка на стенде: `/lore/version` под входом (бандл `assets/index-*.js` пишет global-setup без входа)
- S1 — список спринтов: раскрыть строку со счётчиком `x/y` (y > 0), в раскрытии есть задачи (регресс «задач нет», откат #1005)
- S2 — паспорт спринта: вкладка «Задачи» не пуста
- S3 — новости открываются и показывают строки
- S4 — админка «Агенты»: в колонке harness есть значения

## Адрес

v2 препрода — `https://preprod.lore.odal.seidrstudio.pro` (порт 4412 на ci-server). `http://192.168.3.131:4400` — это пересыльщик ПРОДА (редирект на `lore.odal`), смоук его отвергает, как и любой адрес прода, в том числе по редиректу.

## Вход (один раз, руками)

Пароль в репо и в агентов не попадает. Сохранённый вход делает человек под TEST-учёткой с правами админа:

```
cd web-next
npx playwright codegen --channel=chrome --save-storage=e2e/stand/.auth/stand.json https://preprod.lore.odal.seidrstudio.pro
```

Войти в открывшемся окне, дождаться ленты LORE, закрыть окно. Папка `e2e/stand/.auth/` в git не идёт. Вход хранится в localStorage (`lore.v2.oidc.*`) и со временем истекает — тогда сценарии «не выполнены» с причиной «вход истёк», файл переснять той же командой.

## Запуск

```
cd web-next
LORE_STAND_URL=https://preprod.lore.odal.seidrstudio.pro LORE_STAND_STORAGE_STATE=e2e/stand/.auth/stand.json npm run e2e:stand
```

PowerShell:

```
cd web-next
$env:LORE_STAND_URL = 'https://preprod.lore.odal.seidrstudio.pro'
$env:LORE_STAND_STORAGE_STATE = 'e2e/stand/.auth/stand.json'
npm run e2e:stand
```

## Итог

`e2e/.stand-report/`: `summary.json`, `summary.md`, скрин на сценарий (`S1.png`…), `build.json` (бандл, куда привёл адрес).

- green — все сценарии прошли
- red — хоть один упал; код выхода ненулевой
- not-run — хоть один не выполнен (нет входа, вход истёк, нет прав админа); это НЕ зелёный. С `LORE_STAND_REQUIRE_RUN=1` (так в CI) not-run тоже роняет код выхода

Логика сводки проверяется vitest-ом: `src/standSmoke.test.ts`.

## RBAC под тестовыми учётками (`rbac.stand.ts`)

Кейсы спеки SPEC-LORE-RBAC-ADMIN-TESTCASES, которые проверяются входом человека: RB-01…08, RB-11, RB-40, AD-01, AD-02. ID кейса — первое слово заголовка, он же строка отчёта.

- **Только TEST-учётки** (D-2026-ONLY-TEST-PREFIXED-ACCOUNTS): `test-sa`, `test-admin`, `test-viewer`, `test-user-1..3`. Другой логин прогон отвергает сам (`src/standSmoke/rbac.ts`).
- **Только препрод.** Записи нет: негативные кейсы шлют запись с пустым телом — отказ гейта даёт 403, прошедший гейт получает 400 и ничего не пишет.
- **Кейсы агентов (§4)** здесь не гоняются: нужен секрет клиента, а к прогону он не попадает.

Вход на каждую учётку сохраняет человек, один файл на учётку, имя файла = логин:

```
cd web-next
npx playwright codegen --channel=chrome --save-storage=e2e/stand/.auth/test-viewer.json https://preprod.lore.odal.seidrstudio.pro
```

Нет файла учётки — её кейсы «не выполнены» с именем учётки. RB-08 (просроченный токен) берёт токен из файла входа: он выполняется, когда файл старше срока токена (минуты), иначе «не выполнен».

Запуск (PowerShell):

```
cd web-next
$env:LORE_STAND_URL = 'https://preprod.lore.odal.seidrstudio.pro'
npx playwright test -c playwright.stand.config.ts rbac.stand.ts
```

Папка входов меняется переменной `LORE_STAND_AUTH_DIR`.

## Автологин тестовых учёток (без входа руками)

Владелица 15.11.2026: «доработай тесты, чтобы он сам подставлял тестовые учётки». Пароли берутся из переменной `LORE_STAND_ACCOUNTS_JSON` — в CI это секрет из Infisical (заводит CICDGitHub), локально — из файла владелицы. Принимаются только логины TEST*, пароли не печатаются, прод отвергается.

```
cd web-next
$env:LORE_STAND_URL = 'https://preprod.lore.odal.seidrstudio.pro'
$env:LORE_STAND_ACCOUNTS_JSON = Get-Content <путь к файлу учёток> -Raw   # {"test-sa":"…",…}
npm run e2e:stand:login        # пишет e2e/stand/.auth/<логин>.json и stand.json (= test-sa)
$env:LORE_STAND_STORAGE_STATE = 'e2e/stand/.auth/stand.json'
npm run e2e:stand              # RBAC + смоук
```

В CI — workflow «LORE stand e2e (preprod, test accounts)», запуск по кнопке; Chromium ставится из Playwright (`LORE_STAND_CHANNEL=''`).

## «+ Новая» по типам (`create.stand.ts`, SPRINT_LORE_ADMIN_POLISH/AP-06)

- **CR-00** — опись под test-sa: типы модели стенда (`/lore/model`) с путём создания (паспорт `_new` разрешает или видна «+ Новая») и без него. Список — `create-coverage.md` / `.json` в папке отчёта и строка `[create] CR-00 БЕЗ пути создания: …` в журнале.
- **CR-<тип>** — для каждого типа с формой (`STAND_CREATE_TYPES`, копия `CREATE_TYPES`, совпадение сторожит vitest) под каждой TEST-учёткой: право сервера, кнопка видна ⇔ право, форма открывается, пустой черновик не сохраняется и причина названа. Исход ячейки — `src/standSmoke/createCoverage.ts`.
- **Записи нет**: стенд только для чтения (`writeGuard.ts`), пути удаления записей в UI нет (AP-01). Сохранение, строка в списке и SCD2 — не проверяются этим сценарием.
