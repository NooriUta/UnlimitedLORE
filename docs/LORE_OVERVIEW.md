# LORE — обзор системы

**Перенесено в LORE (2026-07-14):** полное содержимое теперь живёт как документ
`lore_overview_ru` — `:4400/lore?section=knowledge&passport=lore_overview_ru`
(или `query_slice({slice:"doc_by_id", params:{id:"lore_overview_ru"}})` из MCP).
Этот файл больше не обновляется — правьте документ в LORE, не этот .md.

**LORE** — персистентный граф знаний проекта AIDA: архитектурные решения (ADR),
спринты, задачи, компоненты, релизы, quality gates, runbook'и, спеки — единый
источник правды вместо разрозненных markdown-файлов по репозиториям. Живёт в
ArcadeDB (граф), читается/пишется через собственный Quarkus-backend, отображается
в собственном React-фронтенде, доступен LLM-агентам через MCP-сервер.

## Архитектура — 4 слоя

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  LORE frontend   │────▶│  LORE backend    │────▶│    ArcadeDB     │
│  React/Vite      │     │  Quarkus         │     │  граф-БД        │
│  :4400 (docker)  │     │  :9100           │     │  :2480 (Ygg-1)  │
│  :5173+ (dev)    │     │                  │     │  db: system_    │
└─────────────────┘     └──────────────────┘     │  aida_lore      │
                                  ▲                └─────────────────┘
                                  │ HTTP                    ▲
                         ┌──────────────────┐               │ прямой SQL
                         │  MCP-сервер      │               │ (редко, диагностика)
                         │  aida-lore       │───────────────┘
                         │  node stdio      │
                         └──────────────────┘
                                  ▲
                                  │ stdio (MCP protocol)
                            Claude Code / другие LLM-агенты
```

- **ArcadeDB** (`:2480`, контейнер `Ygg-1`, образ `arcadedata/arcadedb:26.6.1`) —
  многобазовый граф-сервер. `system_aida_lore` — одна из БД на нём (соседствует с
  `hound_default`/`hound_demo` — lineage-графом Hound, не путать). Определён в
  `C:/AIDA/aida-root/docker-compose.stable.yml` (или `.prod.yml`) — **не в этом
  репозитории**, LORE — сателлит, который подключается к уже поднятой ArcadeDB.
- **LORE backend** (`backend/`, Quarkus, Java) — единственная точка записи/чтения
  графа для приложения. Два слоя:
  - `LoreSlices.java` — именованные read-запросы («слайсы»), каждый — Cypher/SQL с
    параметрами, отдаются через `GET /lore/slice/<name>?param=...`. Каталог —
    `GET /lore/slices`.
  - Write-эндпоинты (`POST /lore/adr`, `/lore/sprint`, `/lore/qg/run`,
    `/lore/qg/promote`, …) — все SCD2-совместимые upsert'ы с правильными
    рёбрами (`HAS_STATE`, `BELONGS_TO`, `SUPERSEDES`, …). После God-класс
    распила (B2) живут в доменных resource-классах (`LoreAdrResource.java`,
    `LoreSprintTaskResource.java`, `LoreStatusResource.java`, `LoreQgResource.java`,
    `LoreReleaseResource.java`, …), а не в одном `AidaLoreResource.java` — тот
    остался только с read-only `/lore/slices`/`/analytics`/`/slice/{id}` +
    admin ingest. Общая инфра (клиенты ArcadeDB, конфиг, SAFE_ID, хелперы) —
    `LoreResourceBase.java`.
  - `LoreSchemaInitializer.java` — идемпотентный DDL-бутстрап (запускается один
    раз при `lore.bootstrap=true`). См. `backend/db-schema/` — извлечённая копия
    + инструмент разворота с нуля.
- **LORE frontend** (`src/`, React 19 + Vite + TS) — `LorePage.tsx` — роутер по
  разделам (`?section=sprints|adrs|qg|components|...`), каждый раздел — список
  слева (master) + деталь справа (detail), ссылки на сущности — `?section=X&passport=ID`
  (**не GitHub URL** — у сущностей LORE своего внешнего URL нет).
- **MCP-сервер** (`mcp-server/`, `aida-lore-mcp`) — обёртка над HTTP backend'ом
  для LLM-агентов (`adr_new`, `query_slice`, `qg_run_log`, …).
  Собирается `npm run build` → `dist/index.js`, подключается через `.mcp.json`
  (`LORE_BACKEND_URL=http://localhost:9100`).

## Модель данных — ключевые типы

Полная схема — `backend/db-schema/schema-metadata.json` (снимок) и
`create-schema.sql` (DDL). Основные вершины:

| Тип | Что | Ключ | История (Hist) |
|---|---|---|---|
| `KnowADR` | Architecture Decision Record | `adr_id` | `KnowADRHist` |
| `KnowSprint` | Спринт | `sprint_id` | `KnowSprintHist` |
| `KnowTask` | Задача внутри спринта | `task_uid` | `KnowTaskHist` |
| `KnowDecision` | Разовое зафиксированное решение | `decision_id` | — |
| `KnowMilestone` | Веха | `milestone_id` | `KnowMilestoneHist` |
| `KnowRelease` | Релиз/тег | `release_id` | `KnowReleaseHist` |
| `KnowSpec` | Спецификация | `spec_id` | `KnowSpecHist` |
| `KnowRunbook` | Плейбук/раннбук | `runbook_id` | `KnowRunbookHist` |
| `KnowDoc` | Прочий документ | `doc_id` | `KnowDocHist` |
| `LoreComponent` | Компонент платформы (HND, DALI, CHUR, …) | `component_id` | — |
| `QualityGate` | Quality Gate (проверяемый инвариант-набор) | `qg_id` | — |
| `ClRoutineRun` / `ClRoutineMetric` | Прогон QG-рутины / метрика прогона | `run_id` / `metric_id` | — (durable, не SCD2) |
| `KnowUseCase` | Продуктовый слой целиком: и «фича», и сценарий | `uc_id` | — |
| `KnowActor` · `KnowPain` · `KnowGain` · `KnowJob` | Профиль клиента (Остервальдер) | `actor_id` · `pain_id` · `gain_id` · `job_id` | — |

### Продуктовый слой — ОДИН тип с само-иерархией

Вершина продуктового слоя одна: `KnowUseCase`. **«Фича» — это корневой
сценарий**, а не отдельная сущность (ADR-LORE-022, решение №141; схема V13).
Она отвечает на тот же вопрос «какую пользовательскую цель закрываем», только
на верхнем уровне, поэтому разделяет их не тип, а высота по шкале Коберна —
поле `goal_level`:

| Высота | Роль | Пишется через |
|---|---|---|
| ☁ `cloud` · 🪁 `kite` | корень («фича») | `/lore/feature`, MCP `feature_new` |
| 🌊 `sea-level` · 🐟 `subfunction` | сценарий внутри | `/lore/uc`, MCP `uc_new` |

Иерархия — ребро `DECOMPOSES_INTO` (родитель → ребёнок), денормализованный
указатель `parent_uc_id` рядом с ним для индекса. Цикл отбивается на записи
(400): кольцо не даёт ошибки сразу, но уводит по кругу обход слайса и
вычислитель готовности.

**Шесть парных рёбер ценности** — `ADDRESSES`/`RELIEVES`, `PROMISES`/`DELIVERS`,
`HELPS_WITH`/`PERFORMS` — при слиянии типов сохранены. Пара кодирует
**«заявлено vs доставлено»**, а не «фича vs сценарий»: это два разных
утверждения об одном узле, и любой узел вправе нести оба.

Имена слайсов (`features`, `use_cases_of_feature`), эндпоинт `/lore/feature`,
инструмент `feature_new` и слово «Фичи» в UI сохранены намеренно — слияние
изменило модель данных, а не язык, на котором о продукте говорят.


### SCD2-история (важный паттерн)

Изменяемые сущности (ADR, спринт, задача, …) не перезаписываются — каждое
изменение статуса/полей создаёт новую строку `<Type>Hist` с `valid_from`/
`valid_to`, связанную с основной вершиной через `HAS_STATE`. Текущее состояние =
строка с `valid_to = null`/самая свежая по `valid_from`. **Прямой `UPDATE`
основной вершины вместо создания новой Hist-строки ломает историю** — все
write-эндпоинты в `AidaLoreResource.java` это соблюдают, MCP-тулы — тоже. Прямые
ArcadeDB `INSERT`/`UPDATE` в обход MCP/HTTP **запрещены для этих типов**
(см. память `feedback_lore_all_types_only.md`) — это единственный способ не
сломать SCD2 и не оставить слайсы читающими устаревшие данные.

### Quality Gates / SMART-QG (ADR-QG-002)

Отдельная подсистема: `QualityGate` (проверяемый набор инвариантов) →
QG-рутина (bash-скрипт в `C:/AIDA/docs/change/routines-prompts/`) прогоняется →
пишет `ClRoutineRun` + `ClRoutineMetric` (один на инвариант: `key/value/unit/
target/direction/status/source`, `value=-1`→SKIP) через `qg_run_log` →
при FAIL/WARN может завести `QGJobTask`+`QGRecommendation` → пользователь
подтверждает (`rec_promote`) → создаётся реальный `KnowTask`.
Отчёт — `LoreQGDetail.tsx` (4 слоя: что/динамика/почему/регламент, ADR-QG-004),
fleet-триаж по всем гейтам — вкладка Quality в `LoreAnalytics.tsx`.

## Где что искать

| Что нужно | Где |
|---|---|
| Как читается конкретное поле в UI | Слайс в `LoreSlices.java` → React-компонент в `src/components/lore/` |
| Как что-то записывается | Эндпоинт в `AidaLoreResource.java`, или MCP-тул в `mcp-server/src/tools/loreWrite.ts` |
| Полная схема БД | `backend/db-schema/` |
| Список доступных слайсов | `GET http://localhost:9100/lore/slices`, или MCP `list_slices` |
| QG-рутины (bash-скрипты проверок) | `C:/AIDA/docs/change/routines-prompts/qg-gates.md`, `qg-aida-arch.md` |
| ADR-стандарт для QG-метрик | ADR-QG-002 (SMART-QG Metric Standard) — сама живёт в LORE, читается `query_slice adr {id: "ADR-QG-002"}` |

## Смежные документы

- `backend/db-schema/README.md` — разворот схемы ArcadeDB с нуля.
- `docs/DEPLOYMENT.md` — полный разворот всего стека LORE (этот репозиторий).
- `docs/REMOVE_FROM_MAIN_PROJECT.md` — что убрать из `aida-root` после переезда
  LORE/BENCH сюда (миграционный чек-лист, статус: черновик).
