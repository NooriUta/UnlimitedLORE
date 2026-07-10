# LORE — обзор системы

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
  для LLM-агентов (`lore_create_adr`, `lore_query_slice`, `lore_record_qg_run`, …).
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
target/direction/status/source`, `value=-1`→SKIP) через `lore_record_qg_run` →
при FAIL/WARN может завести `QGJobTask`+`QGRecommendation` → пользователь
подтверждает (`lore_promote_recommendation`) → создаётся реальный `KnowTask`.
Отчёт — `LoreQGDetail.tsx` (4 слоя: что/динамика/почему/регламент, ADR-QG-004),
fleet-триаж по всем гейтам — вкладка Quality в `LoreAnalytics.tsx`.

## Где что искать

| Что нужно | Где |
|---|---|
| Как читается конкретное поле в UI | Слайс в `LoreSlices.java` → React-компонент в `src/components/lore/` |
| Как что-то записывается | Эндпоинт в `AidaLoreResource.java`, или MCP-тул в `mcp-server/src/tools/loreWrite.ts` |
| Полная схема БД | `backend/db-schema/` |
| Список доступных слайсов | `GET http://localhost:9100/lore/slices`, или MCP `lore_list_slices` |
| QG-рутины (bash-скрипты проверок) | `C:/AIDA/docs/change/routines-prompts/qg-gates.md`, `qg-aida-arch.md` |
| ADR-стандарт для QG-метрик | ADR-QG-002 (SMART-QG Metric Standard) — сама живёт в LORE, читается `lore_query_slice adr {id: "ADR-QG-002"}` |

## Смежные документы

- `backend/db-schema/README.md` — разворот схемы ArcadeDB с нуля.
- `docs/DEPLOYMENT.md` — полный разворот всего стека LORE (этот репозиторий).
- `docs/REMOVE_FROM_MAIN_PROJECT.md` — что убрать из `aida-root` после переезда
  LORE/BENCH сюда (миграционный чек-лист, статус: черновик).
