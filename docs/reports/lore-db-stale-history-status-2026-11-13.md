# LORE: устаревшее, объекты без истории и без статусов (13.11.2026)

Только чтение прод-базы (`system_aida_lore`) через MCP-срезы. Бэкенд `be7f1ef`, схема v81 (`lore_version`). В LORE ничего не записано.

## Коротко

- **Устаревший снимок схемы в репо.** `backend/db-schema/schema-metadata.json` датирован **01.07.2026**: 51 тип вершин и 36 типов рёбер, включая снятые PlanItem, PlanItemHist и StatusPlanItem. При этом в нём нет примерно 35 типов, заведённых позже (KnowQuestion, KnowUseCase, KnowActor, KnowDictEntry и др.).
- **Сироты без проекта: 384** (`entities_without_project`). Из них вопросов 194, решений 57, сценариев 53, ранбуков 35, доков 32, спек 7, релизов 6. Под скоупом из них прячутся 80 (`scope_orphans`, 19.10 было 499).
- **Без истории живут 4 типа с изменяемым состоянием:** вопросы (405, у них есть статус), компоненты (110), фичи и сценарии (56), гейты качества (25, статус есть). У решений история **есть** (KnowDecisionHist, 1032 из 1079), но у **47 решений нет ни одной версии**, и `history_hygiene` их не видит.
- **Без статуса.** У 377 из 432 спек (87 %) статус null. Нет поля статуса у релизов (516), вех (40), компонентов, доков (428) и ранбуков (30).
- **Значения вне словаря:** 4 задачи со статусом `PARTIAL` без значка, 3 решения (`rejected` ×2, `🚫 CANCELLED` ×1), 11 задач с `task_type` вне словаря (`data` ×7, `bug` ×3, пусто ×1). В словаре нет типов `question_status`, `feature_status` и `qg_status`.
- **Висящие хвосты:** 10 закрытых спринтов с открытыми задачами. У 157 открытых или отложенных вопросов: примерно 31 вопрос уже имеет решение-кандидата, но связи с ним нет; примерно 153 не подняты ни в одном спринте.
- **Задачи чистые.** В статусах задач (6354) нет ни одной в категории unknown; кроме 4 `PARTIAL` без значка, все 6350 несут одно из 10 канонических значений.

---

## 1. Устаревшие элементы

| Что | Число | Источник |
|---|---|---|
| Снимок схемы от 01.07: в нём PlanItem (328 строк), PlanItemHist (696), StatusPlanItem (354), рёбра ON_TRACK и REPRESENTS | 1 файл | `schema-metadata.json` (`snapshot_date`); снятие типов — V54/V57, `LoreSchemaMigrationRunner.java:489,492,1226-1276` |
| Пустые на 01.07 типы и рёбра: KnowDocHist, KnowFindingHist, QGMetric, ClRoutineOutput; рёбра DECIDED_IN, FORMALIZED_AS, GATES, MEASURED_BY, SUPERSEDES, VALIDATES, ClRoutineHas* | 4 типа + 9 рёбер | тот же снимок, `records=0`; **не перемерено** — среза по `schema:types` нет |
| Поля ролей author/executor/reviewer_agent на KnowTask | сняты V39 | `LoreSchemaMigrationRunner.java:2424-2484`; `all_tasks` теперь читает роли по рёбрам (`LoreSlices.java:2490-2491`) |
| Задач без автора / без исполнителя (по рёбрам ролей) | 3094 / 2999 из 6354; открытых без исполнителя — 250 | `all_tasks`, 7 страниц, `fields=…author_agent,executor_agent` |
| Задачи со статусом `PARTIAL` без значка: DLG-08 (SPRINT_DALI_DIALECTS_LORE_VIZ), HD-1 и HD-3 (SPRINT_HOUND_DIALECT_MODEL_DEPTH), PRE-03 (SPRINT_SITE_SEO_PRERENDER) | 4 | `all_tasks` |
| Решения с голым числовым ключом (`1`…`150`): легаси-нумерация | 147 из 1079 | `changed` from=2000-01-01, разбор `ref_id` |
| Вытесненные ADR (11 SUPERSEDED + 1 DEPRECATED), решения `superseded`, спеки `deprecated` | 12 / 12 / 1 | `changed`, status_category=withdrawn |
| Замену ADR-LORE-016 на ADR-LORE-019 граф держит ребром DEPENDS_ON, а не SUPERSEDES | 1 случай из 1 проверенного | `graph` adr ADR-LORE-016 depth 1 — **гипотеза** для остальных случаев |
| Словарь: всего записей / неактивных | 132 / **0** | `dictionary` |
| Мусорная запись словаря `app_setting:ффф` | 1 | `dictionary` |
| Сироты без проекта (по типам выше) | 384 | `entities_without_project` |
| Сироты под скоупом: runbook 35, doc 32, spec 7, release 6, adr 0, sprint 0 | 80 | `scope_orphans` |
| Записи, которые граф скрывает скоупом даже от full-сессии | 187 | `graph` scope=all, `meta.hidden_by_scope` |
| Срез `runbooks` отдаёт 30 записей, а ранбуков без проекта 35: список неполон (**гипотеза**: срез режется скоупом) | 30 < 35 | `runbooks` vs `scope_orphans` |
| Гигиена связок: enb без обоснования 942, uc без REALIZES 464, сценарий без приёмки 3, боль без облегчения 2 | 1411 | `product_hygiene`, 2 страницы |
| enb без обоснования после даты отсечения правила | 537 | `unlinked_enb_tasks` |
| Закрытые спринты с открытыми задачами: SPRINT_BRAGI_ABOUT_PUB, SPRINT_CI_SELECTIVE_FAST, SPRINT_GEOID_STRUCTURAL_ID, SPRINT_INFRA_BACKLOG, SPRINT_LORE_PRODUCT_FIT, SPRINT_OBS_INTEGRATION, SPRINT_SEO_MARKETING_W2, SPRINT_SITE_SEO_PRERENDER, SPRINT_SITE_SEO_V3, SPRINT_VERDANDI_MOBILE | 10 | `closed_sprints_with_open_tasks` |
| Открытые или отложенные вопросы / из них с решением-кандидатом без связи / не поднятые ни в одном спринте | 157 / ≈31 / ≈153 | `question_hygiene`; последние два числа посчитаны вручную по выдаче |
| Актор без владельца: AGENT-FULL_QWEN-LORCETUS | 1 | `actor_identity_orphans` |
| Релизы: всего / проектов / `is_current=true` без фильтра по проекту | 538 / 10 / **10** (по одному на проект, `_warning` нет) | `releases` без `project` |
| Релизы без спринта и без PR; `release_id`, повторяющиеся между проектами | 27; 18 | `releases` |

**Ноль с положительным контролем:**
- **`projects_without_role` = 0.** Срез идёт по KnowGitProject, а `git_projects` отдаёт 24 проекта; 30.08 тот же запрос находил 9 проектов без роли (`LoreSlices.java:1347`).
- **`scope_orphans`: adr = 0, sprint = 0.** Тот же запрос в других ветках вернул 80 строк.
- **Неактивных записей словаря 0.** В SQL среза нет фильтра (`LoreSlices.java:2919-2924`). Оговорка: `ifnull(is_active,true)` показывает null как true.
- **`history_hygiene` = 0.** Ветка «задача или спринт без истории» 07.11 находила 14 задач (`LoreSlices.java:343-345`).
- **`asset_orphans` = 0 — без контроля:** среза со списком всех ассетов нет, ноль не доказан.

**Проверить не смогли, нужен SQL-доступ на чтение:**
- снят ли PlanItem на проде фактически (V54/V57 условные и пропускаются, если типы ещё используются);
- сколько Hist-строк с `state_uid = null`;
- поля, которые живут без схемы (schemaless).

## 2. Объекты без историзации

Карта цепочек — `LoreSlices.HIST_PARENT` (`LoreSlices.java:270-282`), то же, что `HISTORY_TYPES` в `web-next/src/api/contracts/s2.ts:116`. Число записей и наличие версий — инструмент `changed` (from=2000-01-01, поле `history`, скоуп 24 проекта, `complete:true`) плюс totals срезов.

| Тип | История | Записей | Без версий | Нужна ли история | Риск |
|---|---|---|---|---|---|
| task | KnowTaskHist | 6354 | 0 (`history_hygiene`) | да | — |
| sprint | KnowSprintHist | 539 | 0 | да | — |
| adr | KnowADRHist | 260 | 0 | да | — |
| decision | KnowDecisionHist | 1079 | **47** (у всех статус null; 41 с обычным ключом, 6 числовых; заведены в основном в 06–07.2026) | да | высокий: `history_hygiene` проверяет «нет истории» только у задач и спринтов |
| spec / tech | KnowSpecHist | 432 | 0 | да | — |
| release | KnowReleaseHist | 516 | **8** (v1.4.5–v1.6.11, июнь) | да | низкий |
| milestone | KnowMilestoneHist | 40 | 0 | да | — |
| doc, runbook, finding, phase, dict_entry | есть | 428 / 30 / 31 / — / 132 | срезом не мерится | да | средний: не покрыты гигиеной «без истории» |
| **question** | **нет** | 405 | — | **да**: статус open→closed, это аудит решений | высокий |
| **component** (LoreComponent) | нет | 110 | — | желательно: меняются владелец и родитель | средний |
| **feature / use case** (KnowUseCase) | нет | 56 | — | частично: намеренный статус (proposed/dropped) пишет человек | средний |
| **quality_gate** | нет | 25 | — | да: статус есть | средний |
| git_project, actor, pain / gain / job, bragi_publication | нет | 24 / 15 / 38 / 25 / 14 / 8 | — | справочные — нет; у публикации есть статус → желательно | низкий |

Что «KnowDecision без истории» — неверно: Hist-тип есть (`LoreModelTypes.java:64-66`), версии есть у 1032 решений. Дыра есть только у 47 решений без единой версии. Пишет ли `decision_set` статус ещё и плоским полем на вершину — **гипотеза**, не проверял.

## 3. Объекты без статусов

| Тип | Поля статуса нет | Статус null / unknown | Вне словаря | Источник |
|---|---|---|---|---|
| spec | — | **377 из 432** | — | `changed` status_category=unknown; `specs` (460 строк, большинство null) |
| decision | — | 47 | `rejected` ×2 (ADR-LORE-014-D3, 57), `🚫 CANCELLED` ×1 (13) | `changed` |
| feature / use case | — | 1 из 9 корневых (FEAT-LORE-ACCESS); 3 из 56 | — | `changed`, `use_cases` |
| quality_gate | — | 1 из 25; `last_run_status` null у 10 (ни одного прогона) | значения `active`, словаря нет | `quality_gates` |
| release | да (вместо статуса `is_current`) | 516 → unknown | — | `changed` |
| milestone | да | 40 → unknown | — | `changed`, `milestones` |
| component | да | 110 | — | `components` |
| doc / runbook / finding | да (у finding вместо статуса `verified`) | 428 / 30 / 31 | — | поля срезов (400 со списком колонок) |
| task | — | **0** unknown | `PARTIAL` ×4; `task_type`: `data` ×7, `bug` ×3, пусто ×1 | `all_tasks`, 6354 строки |
| sprint | — | 0 unknown | — | `changed` |
| question | — | 0 | статусы есть в `shared/lore-statuses.json`, но не в словаре | `changed`, `dictionary` |
| bragi_publication | — | 0 из 8 | ready / published / draft — словаря нет | `bragi_publications` |

Расхождения словаря:
- В `shared/lore-statuses.json` в списке `adrStatuses` нет `deprecated`, хотя в словаре он есть и один ADR его носит.
- У `decision_status` нет значений для отклонённых или отменённых решений.

## Предложения

Помечено **[прод]** — меняет данные на проде, нужно «да» владелицы.

**P1 — дёшево, данных не трогает**
1. Перегенерировать или удалить `schema-metadata.json` и сверить `create-schema.sql` со схемой v81. В них нет KnowQuestion и KnowUseCase, а снятый PlanItem остался. Трудоёмкость S, риска нет.
2. Добавить в `history_hygiene` ветки «без истории» для decision, release, spec, doc и runbook. Сейчас 47 решений и 8 релизов ей не видны. S.
3. Закрыть тихую потерю `status` у ранбука в `entity_upsert`: неизвестное поле → 400 вместо молчаливого сброса. S.
4. Срез `releases` без `project`: отдавать `_warning`, когда в выдаче больше одного `is_current`. Либо MCP должен подставлять проект по умолчанию. S.
5. Добавить в `lore-statuses.json` `deprecated` в `adrStatuses`. XS.

**P2 — чистка данных [прод]**
6. Привести к каноническим значениям: 4 `PARTIAL` → `🟡 PARTIAL`; 11 значений `task_type`; 3 статуса решений (сопоставить с `superseded` или завести статус в словаре); удалить `app_setting:ффф`. XS, риск низкий.
7. Закрыть или перенести хвосты в 10 закрытых спринтах. S.
8. Около 31 вопроса с решением-кандидатом: поставить связь ANSWERS и закрыть. S–M; каждое решение подтверждает владелица.
9. 384 записи без проекта: начать с 35 ранбуков, 32 доков и 7 спек (они прячутся под скоупом), потом 194 вопроса. M.
10. Статус у 377 спек. Не проставлять `accepted` массово: подставленный статус станет фактом аналитики. Предлагаю ввести явное значение «не размечено» или разметить по списку. M, развилка за владелицей.
11. 47 решений и 8 релизов без версий: открыть начальную версию истории (backfill) без выдуманных дат. S.

**P3 — историзация (только с решением владелицы)**
12. KnowQuestionHist: 405 записей, статус меняется, это история решений. M–L.
13. История статуса QualityGate и намеренного статуса KnowUseCase. M. Компоненты и справочники не историзировать: их правки и так видны в журнале действий.
14. Нужен ли статус ранбукам и докам (например, актуален / устарел) — по аудиту 20.10 (док arch_docs_audit_2026_10_20) из 41 записи архитектурной документации актуальны только 2. Это вопрос к владелице, сам не решаю.

Гигиена связок (1411, `product_hygiene`) остаётся рекомендательной, отдельной чистки не предлагаю.
