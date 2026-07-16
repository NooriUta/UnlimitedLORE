# LORE v1.0.47 — мультипроект/компонент UI, чистка хранилища, версионирование тел

Догоняющий релиз поверх v1.0.46: доделан UI слоя T43, закрыты хвосты хранилища (housekeeping) и капитальная ревизия спеки БД. Задеплоено через Docker Local и проверено на живом бэкенде. **Закрыто три спринта:** UX_FILTERS_LINKS, HOUSEKEEPING_2026W29, MCP_EVOLUTION.

## 🔗 T43 UI — мультипроект/компонент (завершение)
- **`LoreLinkChips`** — редактор мультисвязей (чипы-с-удалением + datalist-добавление).
- Форма **вопроса** и форма **решения** (паспорт ADR): мультипикеры компонентов и проектов (add/remove через рёбра `BELONGS_TO`/`BELONGS_TO_PROJECT`).
- Борд вопросов: `projects[]`-чипы на строках + **фильтр по проекту**; счётчик компонентов учитывает мульти.
- Новый слайс `git_projects` для пикеров.

## 🧹 Housekeeping (SPRINT_LORE_HOUSEKEEPING_2026W29)
- **T01 (LH-01)**: `component/update` теперь синхронизирует ребро `PARENT_OF` с полем `parent_id`. `relinkParentEdge` (child→parent) + бэкфилл **11 разошедшихся** вершин. Проверено live.
- **LH-02**: **checkpoint-версионирование тел ADR/Spec** — `checkpoint=true` в `/lore/adr` и `/lore/spec` делает SCD2 close-open вместо amend-in-place. В MCP `adr_*`/`spec_*`. Проверено: ADR → 2 версии.
- **HK-05**: закрыт фиксом из v1.0.46 (`status_set` 404 на неизвестном id + чистка 51 орфан-Hist).

## 📚 LORE_DB_SPEC (SPRINT_LORE_MCP_EVOLUTION T09)
Капитальная ревизия спеки БД (было пустое тело + «read-only») → **6061 симв.**: 65 вершин, 51 ребро, 1 TIMESERIES; слои доступа; SCD2-модель; каталоги вершин/рёбер; write-инварианты; слайсы.

## Deploy
Docker Local (backend + frontend пересобраны, healthy). MCP пересобран — новые инструменты активируются при перезапуске MCP-сервера. Forgejo-PR — на хендофф.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
