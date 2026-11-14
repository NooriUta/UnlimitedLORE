# Смоук v2 на стенде (E2E-STAND)

Задача: SPRINT_UXR_S11_TEST_OPT/E2E-STAND. Пять сценариев против живого стенда после выкатки в preprod, только чтение:

- S0 — какая сборка на стенде: `/lore/version` под входом (бандл `assets/index-*.js` пишет global-setup без входа)
- S1 — список спринтов: раскрыть строку со счётчиком `x/y` (y > 0), в раскрытии есть задачи (регресс «задач нет», откат #1005)
- S2 — паспорт спринта: вкладка «Задачи» не пуста
- S3 — новости открываются и показывают строки
- S4 — админка «Агенты»: в колонке harness есть значения

## Адрес

v2 препрода — `https://preprod.new.lore.odal.seidrstudio.pro` (порт 4412 на ci-server). `http://192.168.3.131:4400` — это пересыльщик ПРОДА (редирект на `lore.odal`), смоук его отвергает, как и любой адрес прода, в том числе по редиректу.

## Вход (один раз, руками)

Пароль в репо и в агентов не попадает. Сохранённый вход делает человек под TEST-учёткой с правами админа:

```
cd web-next
npx playwright codegen --channel=chrome --save-storage=e2e/stand/.auth/stand.json https://preprod.new.lore.odal.seidrstudio.pro
```

Войти в открывшемся окне, дождаться ленты LORE, закрыть окно. Папка `e2e/stand/.auth/` в git не идёт. Вход хранится в localStorage (`lore.v2.oidc.*`) и со временем истекает — тогда сценарии «не выполнены» с причиной «вход истёк», файл переснять той же командой.

## Запуск

```
cd web-next
LORE_STAND_URL=https://preprod.new.lore.odal.seidrstudio.pro LORE_STAND_STORAGE_STATE=e2e/stand/.auth/stand.json npm run e2e:stand
```

PowerShell:

```
cd web-next
$env:LORE_STAND_URL = 'https://preprod.new.lore.odal.seidrstudio.pro'
$env:LORE_STAND_STORAGE_STATE = 'e2e/stand/.auth/stand.json'
npm run e2e:stand
```

## Итог

`e2e/.stand-report/`: `summary.json`, `summary.md`, скрин на сценарий (`S1.png`…), `build.json` (бандл, куда привёл адрес).

- green — все сценарии прошли
- red — хоть один упал; код выхода ненулевой
- not-run — хоть один не выполнен (нет входа, вход истёк, нет прав админа); это НЕ зелёный. С `LORE_STAND_REQUIRE_RUN=1` (так в CI) not-run тоже роняет код выхода

Логика сводки проверяется vitest-ом: `src/standSmoke.test.ts`.
