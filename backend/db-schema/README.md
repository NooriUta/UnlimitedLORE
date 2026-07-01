# db-schema — system_aida_lore bootstrap & metadata

Материалы для полного разворота схемы ArcadeDB с нуля (disaster recovery / новое
окружение), без запуска Java/Quarkus-бэкенда.

## Файлы

| Файл | Что это |
|---|---|
| `create-schema.sql` | Полный DDL-скрипт: все `CREATE VERTEX/EDGE TYPE`, `CREATE PROPERTY`, `CREATE INDEX`. Извлечён 1:1 из `LoreSchemaInitializer.java` (тот же порядок, тот же список) и **протестирован end-to-end** через `bootstrap.sh` — 172/173 statements OK на живой БД (см. «Известное ограничение» ниже). |
| `bootstrap.sh` | Раннер: читает `create-schema.sql`, прогоняет по одному statement через HTTP `POST /api/v1/command/<db>`. Идемпотентен (`IF NOT EXISTS` везде) — безопасно перезапускать. |
| `schema-metadata.json` | Снимок живой интроспекции (`SELECT FROM schema:types`) на 2026-07-01 — 51 vertex-тип, 36 edge-типов, их явно объявленные свойства и индексы. |

## Как развернуть с нуля

1. Поднять ArcadeDB, создать пустую БД `system_aida_lore` (через Studio или
   `POST /api/v1/server` с командой `create database system_aida_lore`).
2. `cd backend/db-schema && ./bootstrap.sh` (по умолчанию `localhost:2480`,
   `root`/`playwithdata` — переопределить через `ARCADEDB_HOST/PORT/DB/USER/PASS`).
3. Проверить: `curl http://localhost:2480/api/v1/command/system_aida_lore ... "SELECT FROM schema:types"` —
   должно быть 87 типов (51 vertex + 36 edge), сверить со `schema-metadata.json`.
4. Запустить backend (`./gradlew build` → docker) — он начнёт писать в готовую схему.

## Важно: `create-schema.sql` — не единственный источник схемы

**`LoreSchemaInitializer.java` остаётся канонiчным источником** — он выполняется
автоматически при старте backend (когда `lore.bootstrap=true`), и любые новые
типы/свойства/индексы добавляются ТУДА в первую очередь. `create-schema.sql` —
это отдельная копия для случаев, когда нельзя/не нужно поднимать полный Quarkus-стек
(чистый ops-тулинг, ревью схемы, git-diff-able артефакт). **При правке
`LoreSchemaInitializer.java` — синхронизировать `create-schema.sql` вручную**,
они не связаны автогенерацией.

## `schema-metadata.json` — только явно объявленные свойства

ArcadeDB по умолчанию schemaless для свойств — `schema:types` показывает только те
поля, для которых был реально выполнен `CREATE PROPERTY` (или которые попали в
`CREATE INDEX ... UNIQUE`, создающий свойство неявно). Большинство реальных полей
(`KnowADR.name`, `.status`, `.context_md` и т.д.) существуют на каждой боевой записи,
но НЕ объявлены формально — их не будет в этом JSON. За полным списком полей,
которые реально читает/пишет приложение — смотреть Java-код (`LoreSlices.java`
слайсы, `AidaLoreResource.java` write-эндпоинты), не этот файл.

## Найденные при тестировании баги (уже исправлены и в `LoreSchemaInitializer.java`, и здесь)

При первом прогоне `bootstrap.sh` против живой (уже населённой) БД вскрылись два
реальных бага в оригинальном DDL-списке — они были там всегда, просто
`LoreSchemaInitializer.execIgnoreError()` молча их проглатывал:

1. **`CREATE INDEX ... (col)` без явного `UNIQUE`/`NOTUNIQUE`** — на текущей версии
   ArcadeDB отклоняется («Index type is required»). На части индексов, созданных
   исторически (возможно на более ранней версии ArcadeDB), это не заметно — они уже
   существуют, `IF NOT EXISTS` их не трогает. На **действительно пустой** БД все такие
   statements упали бы молча. Исправлено — везде добавлен явный `NOTUNIQUE`.
2. **`CREATE INDEX ... NOTUNIQUE` не создаёт свойство неявно** (в отличие от `UNIQUE`) —
   требует, чтобы `CREATE PROPERTY` был выполнен ДО индекса. Добавлены явные
   `CREATE PROPERTY <Type>.valid_to DATETIME` / `KnowTask.task_id STRING` перед
   соответствующими индексами.

## Известное ограничение (не баг скрипта — проблема данных)

`CREATE INDEX ... ON KnowRelease (release_id) UNIQUE` падает на живой БД:
`release_id="v1.0.0"` задублирован минимум на двух вершинах `KnowRelease`.
Уникальный индекс на этом поле не создать, пока дубликаты не разрешены вручную
(один из релизов нужно переименовать/удалить). На **действительно пустой** БД без
дублей этот statement отработает нормально — ограничение проявляется только при
развороте схемы поверх уже существующих грязных данных.
