# Перенос LORE в новую модель и универсальный установщик — передача работы (18.11.2026)

Ветка `migration/model-v2` (долгая, в develop не влита). Задачи и спеки — в LORE, здесь только карта.

## Задачи и спеки

| Задача | О чём | Спека |
|---|---|---|
| SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 | миграция без эволюции: схема из модели, перенос одним проходом | SPEC-LORE-MIGRATION-NO-EVOLUTION |
| SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03 | сервер на новой модели: статус кодом вместо status_raw | SPEC-LORE-MIGRATION-NO-EVOLUTION, раздел «Сервер» |
| SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 | универсальный установщик: новая установка, перенос, подключение агента | SPEC-LORE-UNIVERSAL-INSTALLER |
| SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 | одно универсальное ребро зависимости (задачи, фазы, спринты, вехи) | в заметке задачи |
| SPRINT_LORE_AGENT_OBSERVABILITY/AO-SESSION-LOG | сессия, harness, машина правки (выкачено в v1.17.27) | SPEC-LORE-TASK-SESSION-LINK |

## Где что лежит

- `*.mjs` в этой папке — установщик и перенос: один файл, без запуска внешних программ (сторож в `cli.test.mjs`).
  - `ui.mjs` — веб-окно на 127.0.0.1: «Старт» (что ставить, Keycloak и секреты, режим), шаги 0–5 переноса.
  - `setup.mjs` — план установки, строка MCP, toml для link, ключи Völva, .env пакета установки.
  - `apply-map.mjs`, `transfer.mjs`, `transfer-edges.mjs`, `dry-run.mjs` — перенос записей и связей.
  - `rules/status-unification.json` — правила проверки и унификации: статусы (коды заглавными), приоритет и harness (строчными), синонимы.
  - `map/all-objects.json` — карта всех 69 типов, 545 полей (генерирует `propose-map-all.mjs`).
  - `rules/install-bundle.json` — пакет deploy/install, вложенный в исполняемый файл (`install-bundle-sync.mjs`).
- `report/` — генератор отчёта `docs/reports/lore-model-v2-vs-prod-2026-11-17.html` и проверка рендера.
- `tools/run/` — запуск прогонов на ryzenai (Linux) и Windows. Доступы к базам читаются из `*.env` и `arcadedb.secret` рядом — **в репо их нет и класть нельзя**; на ryzenai после прогона файлы с доступами удаляются.
- `tools/census/` — переписи прода (поля, связи), пробный расчёт всех объектов (`dry-all.json`: отказов 0), решения UAT.
- `tools/decl/` — генератор книги «Декларация модели» и ответы владелицы (`owner_resolutions.json`).
- `docs/reports/` — отчёты владелице 16–17.11: процесс переноса, история по объектам, блокеры унификации, новая модель против прода.

Тесты: `node --test *.test.mjs` — 130 из 130.

## Что не доделано

1. **Связи для всех объектов.** `transfer-edges.mjs` знает только спринт, фазу и задачу. Нужно: общий список связей, связи из удержанных полей (project, component, *_refs — см. `held` в `tools/census/dry-all.json`), перевод мёртвых HAS_PR, RELEASED_IN, INCLUDES; затем полный перенос на копию на ryzenai и отпечаток.
2. **Аудит записи в модели и схеме.** Не-исторические записи: created_at, created_by и последняя правка (кто, вид, сессия, harness, машина). События: recorded_by и та же тройка. Связи: created_at, created_by, created_by_session, created_by_harness, created_by_machine. Таблица — раздел 7 отчёта.
3. **MIG-03, сервер.** Сервер читает status_raw / status_category (66 мест в LoreSlices, 40 файлов). Перевести на `status` одним выражением; в ответах status_raw собирать из справочника; тест на каждый слайс. Пробный прогон: бэкенд на 9191 к migration_dst_win_B через SSH-туннель ryzenai:2490, `lore.migrate=false`. Сервер на перенесённой базе стартует по маркеру LoreModelSchema (`schemaSource()` = MODEL).
4. **Установщик (MIG-04).** Сделано: «Старт», план, строка MCP и запись в ~/.claude.json с копией, .env пакета, ключи Völva, toml для link. Не сделано: создание области и клиентов Keycloak через admin API на новой установке; machine_new из окна; издатель Völva; проверки связи (whoami, /lore/embed/jwks).
5. **Контракт с miniLORE.** Ключ сессии — пара «машина + код»; machineId строчными; harness — коды miniLORE (claude, kimi, qwen, dsh, codex, opencode, cursor). Ждёт решения владелицы: кто мастер «место → проект». В LORE нет актора minilore-link-* — link не вызывает machine_new (задача miniLORE SPRINT_MINILORE_POLISH/LINK-IMPORT-AUTH).
6. **AgentActionLog** — TIMESERIES, новые поля без DDL не взять; ждёт решения (исключение из заморозки схемы или перенос).

## Правила, которые легко нарушить

- Писать в LORE только через MCP. Локальная база `localhost:2480` — тест, прод — lore-host.
- Перенос не трогает прод: источник читается, приёмник — отдельная база.
- Решения владелицы ST-02..05: fixed и done → ACCEPTED, rejected и CANCELLED → SUPERSEDED; кодов FIXED и DONE нет (сторож в тестах).
- Harness у агента на проде меняет только человек (AL-83).
