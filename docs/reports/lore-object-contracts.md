# Контракт объектов графа LORE (по коду, HEAD 769845cd)

> Собрано 08.11.2026 по запросу сессии kit (паспорта v2, SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24, S4-28…S4-30).
> Только факты из кода со ссылками файл:строка; выведенное помечено как гипотеза. Не согласовано владелицей — это опись «как есть», не контракт «как надо» (тот — SPEC-LORE-UXR-RECORD-CONTRACT).

Источники (пути от корня репозитория):
- MCP-инструменты записи — `mcp-server/src/tools/loreWrite.ts` (**W:строка**), чтения — `mcp-server/src/tools/loreRead.ts` (**R:**).
- Реестр срезов — `backend/src/main/java/studio/seer/heimdall/lore/LoreSlices.java` (**S:строка**). Все срезы — `GET /lore/slice/{id}` (`AidaLoreResource.java:928`), каталог — `GET /lore/slices` (`AidaLoreResource.java:166`). Любой срез принимает `limit`/`offset`/`fields` (R:85-88).
- REST-ресурсы — тот же пакет `Lore*Resource.java`; все пути записи — `POST`, требуют admin/superadmin (`requireAdmin`).
- Схема — `LoreSchemaInitializer.java` (вершины :154-200, :407-412, :466-617, :682-768; рёбра :203-267, :414, :457, :626-635, :751-774) и `LoreSchemaMigrations.java` (KnowFeature :355, KnowUseCase :367, KnowActor :385, KnowPain :432, KnowGain :442, KnowJob :498, KnowProjectActor :929, VP-рёбра :453-523). Отдельных `V*__*.sql` в `src/main/resources` нет. Схема в основном schemaless — поля определяются путями записи.
- Канон статусов — `shared/lore-statuses.json`; зеркала: `LoreResourceBase.java:39-45`, `StatusHistoryService.java:71-80`.
- UI v1 — `src/api/searchRoutes.ts:14-53` (разделы и подписи типов), `src/i18n/locales/ru/common.json`.

Обозначения: **обяз.** — обязательно при создании (по REST; если MCP строже — указано). **SCD2** — поле в строке `*Hist` (через HAS_STATE), версионируется. «—» в подписи — в i18n не найдено (искал `common.json`, `searchRoutes.ts`).

---

## 0. Сводная таблица

| Тип (вершина) | Чтение одной записи | Список | Запись (MCP) | Статусы |
|---|---|---|---|---|
| sprint (KnowSprint) | `sprint_tree {id}` S:723 | `sprints` S:688 | sprint_new / sprint_set / sprint_plan_set / sprint_link | `status_set`: todo, planned, active, partial, done, blocked, cancelled, backlog, design, ready_for_deploy |
| task (KnowTask) | `tasks_by_uids {task_uids}` S:1407 | `tasks_of_sprint {sprint_id}` S:804, `open_tasks`, `all_tasks` | task_new / task_set / task_mv / task_link | plan-набор; на `done` гейт reviewer ≠ executor |
| phase (KnowPhase) | — | `phases_of_sprint {sprint_id}` S:771 | sprint_phase_new | plan-набор через status_set(phase) |
| checkpoint (PlanCheckpoint) | — | `plan_checkpoints` S:1613 | нет (только ingest) | status_set(checkpoint) → REST 501 |
| ADR (KnowADR) | `adr {id}` S:393 | `adrs` S:376 | adr_new / adr_set / adr_link / adr_rename / adr_del | MCP: PROPOSED, ACCEPTED, DEPRECATED, SUPERSEDED (см. §0.3) |
| decision (KnowDecision) | `decision {id}` S:503 | `decisions` S:463 | decision_new / decision_set / decision_link | словарь `decision_status`: proposed, accepted, deferred, superseded, fixed, done |
| spec (KnowSpec) | `spec_by_id {id}` S:1695 | `specs` S:1672 | spec_new / spec_set / spec_link / spec_del / tech_set | словарь `spec_status`: proposed, accepted, deprecated, superseded |
| doc (KnowDoc) | `doc_by_id {id}` S:1871 | `docs` S:1843 | doc_new / doc_link / doc_del | статуса нет |
| runbook (KnowRunbook) | `runbook_by_id {id}` S:1903 | `runbooks` S:1893 | runbook_new / runbook_link | статуса нет |
| question (KnowQuestion) | `question_by_id {id}` S:641 | `questions` (= `open_questions`) S:574 | question_new / question_set / question_link | open, deferred, dropped; `closed` только связью answers |
| release (KnowRelease) | — (по id не найдено) | `releases` S:2090 | release_new / release_set / release_link / release_unlink / release_mv | статуса нет; флаг `is_current` |
| milestone (KnowMilestone) | — | `milestones` S:1433, `roadmap {code}` S:1455 | milestone_new / milestone_set / milestone_link / milestone_sprints | статуса нет |
| component (LoreComponent) | `component {id}` S:1642 | `components` S:1626 | component_new / component_set / component_del | статуса нет |
| git project (KnowGitProject) | — | `git_projects` S:1622 | project_new / project_role_set | статуса нет |
| product (KnowDictEntry, dict_type=product) | — | `products` S:2397 | dict_set + product_link | `is_active` |
| UC / feature (KnowUseCase) | `uc_by_id {id}` S:625 | `features` S:835, `use_cases_of_feature {id}` S:887 | uc_new / feature_new / uc_link / feature_link | вручную только proposed, dropped; active, shipped, in_rework вычисляются |
| project actor (KnowProjectActor) | — | `actors` S:963 | project_actor_new | статуса нет |
| agent identity (KnowActor) | — | `agent_owners` S:1284, `agent_sessions` S:1297 | actor_new / actor_link / agent_session_log | статуса нет |
| pain (KnowPain) | — | `pains` S:923 | pain_new / feature_link / uc_link / vp_link | нет (severity) |
| gain (KnowGain) | — | `gains` S:935 | gain_new / … | нет (rank) |
| job (KnowJob) | — | `jobs` S:949 | job_new / … | нет |
| QG (QualityGate) | `quality_gate_by_id {id}` S:1922 | `quality_gates` S:1914 | qg_new | свободный текст (active, draft, deprecated) |
| QGJobTask | — | `qg_job_tasks {qg_id}` S:1932, `qg_violations` S:1948 | qg_job_new | open, resolved |
| rec (QGRecommendation) | — | `qg_recommendations {qg_id}` S:1937, `qg_pending_recs` S:1954 | rec_new / rec_promote | pending, dismissed, promoted |
| QG run (ClRoutineRun/Metric) | `qg_run_metrics {run_id}` S:1973 | `qg_routine_runs` S:1961 | qg_run_log | OK, WARN, FAIL, PARTIAL |
| finding (KnowFinding) | `finding_by_id {id}` S:2084 | `findings` S:2076 | нет (только ingest) | нет (verified) |
| BRAGI publication | — | `bragi_publications` S:2211 | bragi_pub_new | `status_general`, свободный текст |
| BRAGI variant | — | `bragi_calendar` S:2239 (только с датой) | bragi_variant_new | `status`, свободный текст |
| insight (BragiInsight) | — | `bragi_insights` S:2344 | insight_new / insight_link | нет |
| metric (MetricSnapshot, TIMESERIES) | — | `bragi_analytics` S:2269 | metric_log / bragi_sync; чтение metric_get | не вершина графа |

### 0.1 Общие механизмы
- **Смена статуса (SCD2):** `status_set` (W:329-345) → `POST /lore/status`, `LoreStatusResource.updateStatus` (`LoreStatusResource.java:79-210`). REST-список `entity_type`: plan_item, sprint, task, checkpoint, adr, phase (`LoreResourceBase.java:39-40`); обрабатываются только sprint, task, phase, adr, остальные — 501 (`LoreStatusResource.java:165-167`). MCP пропускает sprint, task, checkpoint, phase (W:334). Пакетно — `status_set_batch` (W:1078-1091) → `POST /lore/status/batch` (`LoreStatusResource.java:678`).
- **Токены → status_raw:** done → «✅ DONE», active → «🔄 IN PROGRESS» и т.д. (`shared/lore-statuses.json`, `statusRaw`). Подписи UI — `common.json` `status.*` (done «Готово», active «В работе», partial «Частично», ready_for_deploy «К деплою», blocked «Заблокировано», cancelled «Отменено», design «Дизайн», backlog «Бэклог», planned «Запланировано», deferred «Отложено», todo «К выполнению»).
- **Единый сервис истории статусов** `StatusHistoryService.transition` — task, sprint, phase, adr, spec, decision (`StatusHistoryService.java:71-80`). Значение не валидирует — валидация на вызывающем ресурсе.
- **Оптимистическая блокировка:** `expected` → 409 CONFLICT (W:117-127, 130-141).
- **Проект при создании (AL-113):** adr_new, doc_new, spec_new, runbook_new, question_new, uc_new, feature_new, tech_set без `project` и без `LORE_ACTIVE_PROJECT` отклоняются до записи (W:198-228); ребро — тем же путём, что `*_link rel=project` (W:200-208).
- **История любой сущности:** `GET /lore/history?type&id` (`LoreHistoryResource.java:43`) для `LoreSlices.HIST_PARENT` (S:188-200): adr, decision, doc, finding, milestone, phase, release, runbook, spec, task, sprint, dict_entry.
- **Поиск:** `GET /lore/search` (`LoreSearchResource.java:334`), MCP `search` (R:134-169); `search_similar`; `GET /lore/backlinks` (`LoreSearchResource.java:971`).
- **Связь из упоминания:** `GET /lore/link/types`, `POST /lore/link/mention` (`LoreLinkResource.java:54-119`, каталог `LoreLinkTypes`); запасное ребро REFERENCES.
- **Картинка к md-полю:** `asset_up` (W:2380-2402) → `POST /lore/asset/upload`; `entity_type`: adr, sprint, task, feature, uc, actor, component, spec, doc, runbook, question, decision, milestone (`LoreAssetResource.java:52-65`); KnowAsset + ATTACHED_TO.
- **Вердикт полноты без записи:** `quality_check` (W:766-786) → `POST /lore/quality` для task, sprint, adr, decision, spec, release, component, milestone, question.
- **Обязательная проектная ось** (`LoreSlices.PROJECT_OWNED`, S:256-266): sprint, adr, decision (проект может прийти от родительского ADR), question (через RAISED_IN), release, spec, doc, runbook, use_case.

### 0.2 Подписи типов в UI v1
`searchRoutes.ts:37-53`: adr «ADR», decision «решение», question «вопрос», spec «спека», doc «док», runbook «ранбук», sprint «спринт», task «задача», quality_gate «QG», feature «фича», use_case «US», actor «клиент», pain «боль», gain «ожидание», job «работа».
Разделы (`searchRoutes.ts:14-34`): adrs, decisions, openQuestions, knowledge (spec, doc, runbook), sprints (задача — внутри спринта), qg, features, userStories, actors, vpProfile (pain, gain, job).

### 0.3 Расхождения между кодом и описаниями
1. **Статусы фичи и UC.** `feature_new` разрешает proposed, active, dropped (W:568), `uc_new` — proposed, active, shipped, dropped (W:606). Backend вручную принимает только proposed и dropped, остальное — 400 (`UcReadinessCalculator.java:47-49`, `LoreProductResource.java:144-147, 210-213`); active, shipped, in_rework вычисляет `UcReadinessCalculator` по задачам.
2. **Статус ADR — три набора.** MCP `adr_new`/`adr_set`: PROPOSED, ACCEPTED, DEPRECATED, SUPERSEDED (W:1102). REST `/lore/adr` не проверяет, приводит к верхнему регистру (`StatusHistoryService.java:105`), по умолчанию PROPOSED (`LoreAdrResource.java:70-71`). REST `/lore/status` для adr: proposed, accepted, draft, deferred, superseded — без deprecated (`LoreResourceBase.java:44-45`); MCP `status_set` adr не пропускает. Подписи UI `adrStatus.*`: proposed, accepted, deprecated, superseded.
3. **checkpoint.** MCP `status_set` разрешает, REST отвечает 501 (`LoreStatusResource.java:165`).
4. **История решения.** Описание `decision_new`/`decision_set` — «vertex-only, без истории» (W:1269-1270, 1307-1308); на деле статус пишется новой версией `KnowDecisionHist` (`LoreDecisionResource.java:128-143, 270-274`). Устаревший комментарий и в ресурсе (`LoreDecisionResource.java:25, 237-240`).
5. **Проект релиза.** `release_new`/`release_set`: «default NooriUta/AIDA» (W:1471-1472, 1495-1496); REST без проекта — 400 `NO_PROJECT` (`LoreReleaseResource.java:102-106, 200`).
6. **outcome_md спринта** пишется в вершину (`LoreIngestService.java:86-87`, `LoreSprintTaskResource.java:1270-1271`); `context_md` с вершины читают `sprints` и `sprint_tree` (S:708, S:724), а `outcome_md` — только `history_sprint` (S:1732) из KnowSprintHist. Среза, отдающего `outcome_md` с вершины, не найдено.
7. **raised_in к задаче** пишется (`LoreQuestionResource.java:213-240`), срезы читают только `raised_adr`, `raised_sprint` (S:587-588, 648-649).
8. **title спеки** обязателен в MCP (W:1559, 1594), REST не требует (`LoreSpecResource.java:60-71, 85`).
9. **Только через REST:** question `opened_date`/`closed_date` (`LoreQuestionResource.java:60-63`); sprint `no_release_required`, `unplanned_intentional` (`LoreSprintTaskResource.java:49-51`); phase `summary_md` (:82-83); component `POST /lore/component/link-parent` (`LoreComponentResource.java:303`).
10. `release_link` — IMPLEMENTED_IN_RELEASE «KnowSprint → KnowRelease», срезы читают так же (S:694). Расхождения нет.

---

## 1. Спринт — KnowSprint (+KnowSprintHist)
Подпись: «Спринт» (`shell.hit.sprint`).

| Поле | Подпись (ru) | Вид | Обяз. | Правка |
|---|---|---|---|---|
| sprint_id | «ID спринта» (`lore.sprintEditor.fields.sprintId`) | text, SAFE_ID | да | нет |
| name | «Название» (`lore.sprintEditor.fields.name`) | text | REST нет (MCP да, W:472) | sprint_set |
| status_raw (SCD2) | «Статус» (`lore.sprintEditor.fields.status`) | enum plan, по умолч. todo | нет | только status_set |
| priority (SCD2) | «Приоритет»; `lore.sprintDetail.priority.p0..p3` | текст (dict priority) | нет | sprint_plan_set |
| planned_start_date / planned_end_date (SCD2) | «Плановая дата старта / завершения» (`lore.sprintDetail.plan.*`) | дата | нет | sprint_plan_set |
| track_id (SCD2) | — | ref PlanTrack | нет | sprint_plan_set |
| pr_refs (SCD2) | «PR» (`lore.sprintDetail.prBar.label`) | text | нет | sprint_set(pr_numbers) → /lore/sprint/refs |
| context_md (вершина) | «Контекст» (`lore.sprintDetail.context.label`) | md | нет | sprint_set (context_md / context_append) |
| outcome_md (вершина) | — | md | нет | sprint_set (outcome_md / outcome_append); см. §0.3 п.6 |
| plan_id | — | text | нет | sprint_set |
| effort_days | «Итого effort» (`lore.sprintDetail.effortFooter.label`) | number | нет | sprint_set |
| no_release_required, unplanned_intentional | «Не требует релиза» (`lore.sprintDetail.plan.noReleaseRequired`) | bool | нет | только REST /lore/sprint/update |
| created_date | «Создан» | дата, система | — | нет |
| block_reason (SCD2, при blocked) | — | text | — | status_set(reason) |

**Чтение:** `sprint_tree {id}` (S:723), `sprints [status, project]` (S:688), `history_sprint {id}` (S:1729), `sprint_deps`, `sprint_deps_of {id}` (S:746, 752), `blocked_sprints_reason` (S:1768), `component_sprints`, `product_sprints`, `release_sprints*`, `roadmap_unplanned`.
**Запись:** `sprint_new` (W:463-490) → `/lore/sprint/create`, `LoreSprintTaskResource.createSprint` (:94-143), upsert, статус по PLAN_STATUSES (:106-109), первая строка истории (`LoreIngestService.createSprint` :71). `sprint_set` (W:496-549) → `/lore/sprint/update` (:1238-1300) и/или `/lore/sprint/refs` (:1086). `sprint_plan_set` (W:961-993) → `/lore/sprint/plan` (`LoreStatusResource.java:509`). `status_set(sprint)`; при blocked `reason` → `block_reason` (`LoreStatusResource.java:218-235`); статус спринта выводится и автоматически от задач (:203).
**Рёбра:** BELONGS_TO_PROJECT → KnowGitProject (`sprint_new(project)` / `sprint_link rel=project` → `/lore/sprint/project` :1318); DEPENDS_ON → KnowSprint, свойства kind (hard, soft, gate, informs) и reason (`sprint_link rel=dep` → `/lore/sprint/dep` :1746, цикл отклоняется); BELONGS_TO → LoreComponent (`rel=component` → `/lore/sprint/component` :1374); TARGETS_MILESTONE → KnowMilestone (`rel=milestone` → `/lore/milestone/sprint` или `milestone_sprints`); IMPLEMENTED_IN_RELEASE → KnowRelease (`release_link rel=sprint`). Входящие: PART_OF ← KnowTask, KnowPhase; IMPLEMENTED_IN ← KnowADR (`adr_link rel=sprint`), KnowDoc (`doc_link rel=sprint`); RAISED_IN ← KnowQuestion; PRODUCED_BY ← Bragi*. HAS_STATE → KnowSprintHist.

## 2. Задача — KnowTask (+KnowTaskHist)
Подпись: «Задача» (`shell.hit.task`). Ключ `task_uid = "<sprint_id>/<task_id>"`.

| Поле | Подпись | Вид | Обяз. | Правка |
|---|---|---|---|---|
| sprint_id | — | ref sprint | да | нет (перенос — task_mv) |
| task_id | — | text, SAFE_ID | да | нет |
| title | — | text | да | task_set (обязателен и при правке, `LoreSprintTaskResource.java:1001`) |
| status_raw (SCD2) | `status.*` | enum plan, при создании «📋 PLANNED» (:336) | — | status_set |
| note_md (SCD2) | — | md | нет | task_set (note_md / note_append) |
| effort_days (SCD2) | «Стоимость, дн» (`lore.sprintDetail.task.effortLabel`) | number ≥0, 1 = 8 ч | нет | task_set |
| actual_days | — | number ≥0 | нет | task_set |
| bookkeeping | — | bool | нет | task_set |
| task_type | «Тип» (`…task.typeLabel`) | planning, design, dev, test, ops, research, analytics, docs, content; по умолч. dev | нет | task_set |
| work_class | «Зачем» (`…task.workClassLabel`) | enum uc, jtd, enb | нет | task_set |
| uc_id (ребро REALIZES) | «Сценарий (REALIZES)» (`…task.ucLabel`) | ref UC | нет | task_set (пустая строка отвязывает) |
| author / executor / reviewer | — | ref на личность (ROLE_HELD_BY) | агенту обязательны author и executor (:265-271) | task_set; REST /lore/task/role (:223) |
| order_index, phase_uid | — | number; ref phase | система; phase — нет | task_link rel=phase |

**Чтение:** `tasks_by_uids {task_uids}` (S:1407); `tasks_of_sprint {sprint_id}` (S:804), `tasks_of_sprints_batch {sprint_ids}` (S:1387), `tasks_of_phase {phase_uid}` (S:781), `open_tasks [project, sprint, component, work_class]` (S:2054), `all_tasks` (S:2005), `backlog_tasks` (S:2000), `tasks_of_uc {id}` (S:987), `release_tasks_by_tag {tag}` (S:2162); `history_task {id}` (S:1740), `task_roles`/`task_roles_history {id}` (S:546, 556), `files_of_task {id}` (S:528), `gating_questions_of_task {id}` (S:680); MCP `task_shape` → `GET /lore/task-shape` (R:196-217).
**Запись:** `task_new` (W:347-380) → `/lore/task`, `createTask` (:238-400), обязательны sprint_id, task_id, title (:249-251), в закрытый спринт нельзя (:282-283). `task_set` (W:1808-1875) → `/lore/task/edit` (:993) или `/lore/task/edit/batch` (:816). `task_mv` (W:382-399) → `/lore/task/move` (:540) — отмена исходной + новая. `status_set(task)`: done запрещён без reviewer или при reviewer = executor (`LoreStatusResource.java:139-141`); при done/cancelled ребро GATES получает `solved_at` (:56-61).
**Рёбра:** PART_OF → KnowSprint; IN_PHASE → KnowPhase (`task_new(phase_uid)` / `task_link rel=phase` → `/lore/task/phase` :744); TAGGED_WITH → LoreComponent (`rel=component` → `/lore/task/component` :1443); EDITED_IN с KnowFile (по срезу KnowFile `out('EDITED_IN')` → задача, S:532; `rel=file` → `/lore/task/file` :1679); JUSTIFIED_BY → KnowADR (`rel=adr` → `/lore/task/adr` :1614); CLOSED_BY → KnowPR (`rel=pr` → `/lore/task/pr` :1547); REALIZES → KnowUseCase (`task_new(uc_id)`, `task_set(uc_id)`, `uc_link rel=task`); ROLE_HELD_BY → KnowActor/KnowUser (role, valid_from, valid_to). Входящие: GATES ← KnowQuestion, PROMOTED_TO ← QGRecommendation, LED_TO ← BragiInsight, PRODUCED_BY ← Bragi*.

## 3. Фаза — KnowPhase (+KnowPhaseHist)
Ключ `phase_uid = "<sprint_id>/PHASE_<KEY>"`.
- **Поля:** sprint_id, phase_key обязательны (`LoreSprintTaskResource.java:666`); name, order_index — нет; `summary_md` только REST. Подписей нет (кроме `lore.sprintDetail.phases.sectionLabel` «Фазы»).
- **Чтение:** `phases_of_sprint {sprint_id}` (S:771); название фазы срез берёт из `KnowPhaseHist.status_raw` (S:774).
- **Запись:** `sprint_phase_new` (W:401-418) → `/lore/phase` (:659), идемпотентно. Статус — `status_set(phase)`, plan-набор.
- **Рёбра:** PART_OF → KnowSprint; входящие IN_PHASE ← KnowTask; HAS_STATE.

## 4. Чекпоинт — PlanCheckpoint
- **Поля:** checkpoint_id, label, desc_md (S:1613-1616).
- **Чтение:** `plan_checkpoints` (S:1613).
- **Запись:** через MCP и REST не найдена (искал `INTO PlanCheckpoint`, `PlanCheckpoint SET` в пакете lore). `status_set(checkpoint)` → 501.
- **Рёбра:** ON_MILESTONE → KnowMilestone (по срезу).

## 5. ADR — KnowADR (+KnowADRHist)
Редактор `LoreAdrEditor.tsx`, паспорт `LoreAdrPassportView.tsx`.

| Поле | Подпись | Вид | Обяз. | Правка |
|---|---|---|---|---|
| adr_id | «ADR ID» (`lore.adrEditor.fieldAdrId`) | text, SAFE_ID | да | adr_rename |
| name | «Название» (`lore.adrEditor.fieldName`) | text | REST нет (пишется null); MCP да при каждом вызове (W:1101, 1140) | adr_set |
| status (вершина + status_raw в истории) | «Статус» (`fieldStatus`); `adrStatus.*` | enum, §0.3 п.2; по умолч. PROPOSED | нет | adr_set |
| date_created | «Дата» (`fieldDate`) | дата | нет (сегодня) | adr_set |
| context_md (SCD2) | «Контекст» (`adrPassportView.context`) | md | нет | adr_set |
| decision_md (SCD2) | «Решение» | md | нет | adr_set |
| consequences_md (SCD2) | «Последствия» | md | нет | adr_set |
| file_path | — | text | нет | adr_set |
| checkpoint | — | bool: правка тела открывает новую версию | — | — |

**Чтение:** `adr {id}` (S:393), `adrs [component]` (S:376), `adr_history {id}` (S:425), `adr_history_all` (S:437), `timeline_adrs` (S:292), `decisions_of_adr {id}` (S:487), `questions_of_adr {id}` (S:653).
**Запись:** `adr_new`/`adr_set` (W:1093-1164) → `/lore/adr`, `LoreAdrResource.createAdr` (:46-370), upsert, обязателен только adr_id (:53-56). `adr_rename` → `/lore/adr/rename` (:725). `adr_del` → `/lore/adr/delete` (:764).
**Рёбра** (наборы id в adr_new/adr_set заменяют весь набор; `adr_link` — по одному, W:1167-1209): BELONGS_TO → LoreComponent (`rel=component` → `/lore/adr/component` :532; также `component_id(s)`); DEPENDS_ON → KnowADR (`rel=depends_on` :579); SUPERSEDES → KnowADR, от нового к старому (`rel=supersedes` :626); TAGGED_WITH → KnowTag (`rel=tag` :673); BELONGS_TO_PROJECT (`rel=project` :484); IMPLEMENTED_IN → KnowSprint (`rel=sprint` → `/lore/adr/link` :376); IMPLEMENTED_IN_RELEASE → KnowRelease (`rel=release`). Входящие: DECIDED_IN ← KnowDecision, TRACED_TO ← UC, JUSTIFIED_BY ← KnowTask, REFERENCES_ADR ← KnowRunbook, RAISED_IN ← KnowQuestion, LED_TO ← BragiInsight.

## 6. Решение — KnowDecision (+KnowDecisionHist для статуса)

| Поле | Подпись | Вид | Обяз. | Правка |
|---|---|---|---|---|
| decision_id | — | text | да | нет |
| title | — | text | да (`LoreDecisionResource.java:65-66`) | decision_new (при каждом вызове) |
| body_md | — | md | нет | decision_new |
| status_raw (SCD2) | «Статус» (`lore.decisionBoard.statusLabel`) | enum, словарь decision_status (запасной список :36-37) | нет | decision_set → `/lore/decision/status` (:245) |
| date_created | — | дата | нет (сегодня) | decision_new |
| refs_raw | — | text | нет | decision_new |
| rationale_md, adr_refs, sprint_refs, pr_refs, release_refs | «Обоснование» (`decisionBoard.rationaleLabel`) | md / text | — | MCP не пишет (читает срез `decision`, S:507-508; гипотеза — заполняет ingest) |
| component_id | «Компонент» | ref | нет | decision_new, decision_link |
| updated_at | — | момент, система | — | — |

**Чтение:** `decision {id}` (S:503), `decisions` (S:463), `decisions_of_adr {id}` (S:487), `release_decisions {tag}` (S:2132), `decision_history_all` (S:454), `timeline_decisions` (S:307).
**Запись:** `decision_new` (W:1265-1298) → `/lore/decision`, `createDecision` (:56-217); проект обязателен, если нет `adr_id` (W:1297). `decision_set` (W:1303-1316) → `/lore/decision/status`.
**Рёбра:** DECIDED_IN → KnowADR (может быть несколько родителей; `decision_new(adr_id)` :151-156); BELONGS_TO → LoreComponent (`decision_link rel=component` → `/lore/decision/component` :292; также `component_id`); BELONGS_TO_PROJECT (`decision_new(project)` / `decision_link rel=project` :335); TAGGED_WITH → KnowTag (`tags`, только добавление); SUPERSEDES → KnowDecision (читается срезом S:521, пути записи не найдено). Входящие: ANSWERS — из решения в вопрос (`question_link rel=answers`); TRACED_TO ← UC (`uc_link rel=decision`).

## 7. Спецификация — KnowSpec (+KnowSpecHist)
Подпись: «Спека».

| Поле | Подпись | Вид | Обяз. | Правка |
|---|---|---|---|---|
| spec_id | — | text | да | нет |
| title | — | text | MCP да; REST нет | spec_set |
| content_md (SCD2, копия на вершине) | — | md | нет | spec_set |
| summary (SCD2) | — | text | нет | spec_set |
| version (SCD2; новый номер — новая версия) | — | text | нет | spec_set |
| status (SCD2) | — | enum, словарь spec_status | нет | spec_set (`LoreSpecResource.java:66-71, 100-116`) |
| component_id (ребро DOCUMENTED_IN) | — | ref | нет | spec_set (пустая строка отвязывает) |
| file_path | — | text | нет | spec_set |

**Чтение:** `spec_by_id {id}` (S:1695), `specs [component, project]` (S:1672), `tech_registry [component]` (S:1713), `spec_history_all` (S:448), `timeline_specs` (S:357).
**Запись:** `spec_new`/`spec_set` (W:1551-1607) → `/lore/spec`, `upsertSpec` (:53). `spec_link` (W:1609-1634) → `/lore/spec/link` (:255): rel component|project, mode add|remove|replace (по умолч. replace). `spec_del` → `/lore/spec/delete` (:379). `tech_set` (W:1644-1686) — тот же `/lore/spec`, id `SPEC-TECH-<COMP>-<TECH>`.
**Рёбра:** DOCUMENTED_IN от компонента к спеке (in); BELONGS_TO → компонент; BELONGS_TO_PROJECT; HAS_STATE.

## 8. Документ — KnowDoc
Подпись: «Документ».
- **Поля:** `doc_id` (обяз.); `title` (обязателен при первом создании по описанию MCP W:1737; REST не проверяет); `kind` (свободный текст: page, fragment, guide, reference, research, product, site, prompt); `has_ext_deps` (bool), `component_id`, `file_path`; `content_md_en`, `content_md_ru` (md), `content_html` (устаревшее, до 100 КБ); `parent_doc_id` (ref doc), `sort_order` (number). Всё правится `doc_new` (upsert, `LoreDocResource.java:44-112`). Статуса нет; SCD2-пути записи нет (комментарий S:1872-1876).
- **Чтение:** `doc_by_id {id}` (S:1871), `docs [component, kind, project]` (S:1843).
- **Запись:** `doc_new` (W:1728-1760) → `/lore/doc`; `doc_link` (W:1763-1794); `doc_del` → `/lore/doc/delete` (:118).
- **Рёбра:** DOC_CHILD_OF → KnowDoc (родитель один; `doc_link rel=parent` → `/lore/doc/parent` :170); BELONGS_TO → компонент (`rel=component` :237); IMPLEMENTED_IN → KnowSprint (`rel=sprint` :334); BELONGS_TO_PROJECT (`rel=project` :284).

## 9. Ранбук — KnowRunbook (+KnowRunbookHist)
- **Поля:** `runbook_id` (обяз.), `name` (MCP обяз.; REST пишет как пришло, `LoreRunbookResource.java:150`), `area` (свободный текст: recovery, infra, deploy, ops, auth, db, service), `date_created` (сегодня), `content_md` (SCD2). Подписи — `lore.runbookList.*` (полей нет).
- **Чтение:** `runbook_by_id {id}` (S:1903), `runbooks [area]` (S:1893).
- **Запись:** `runbook_new` (W:1707-1726) → `/lore/runbook` (:131); `runbook_link` (W:1212-1238).
- **Рёбра:** REFERENCES_ADR → KnowADR (`rel=adr` → `/lore/runbook/adr` :36); BELONGS_TO_PROJECT (`rel=project` :82).

## 10. Вопрос — KnowQuestion
Подпись: «Вопрос».

| Поле | Подпись | Вид | Обяз. | Правка |
|---|---|---|---|---|
| question_id | — | text | да | нет |
| title, body_md | — | text / md | нет | question_set |
| status | «Статус» (`lore.oqBoard.statusLabel`) | open, deferred, dropped, closed; closed вручную запрещён (`LoreQuestionResource.java:76-80`) | нет | question_set |
| trigger | — | text; обязателен при deferred (:82-83) | — | question_set |
| due_date | «срок ответа» (`oqBoard.dueTitle`) | дата | нет | question_set |
| priority | «Приоритет» (`oqBoard.priorityLabel`) | blocker, high, normal, low (MCP W:1366) | нет | question_set |
| owner, raised_by | — | text | нет | question_set |
| component_id | «Компонент» | ref | нет | question_set / question_link |
| opened_date, closed_date | — | дата | только REST | — |

**Чтение:** `question_by_id {id}` (S:641), `questions`/`open_questions` (S:574-593), `question_hygiene` (S:605), `questions_of_adr {id}`, `questions_of_sprint {id}`, `questions_gating_closed_tasks`, `gating_questions_of_task {id}`.
**Запись:** `question_new` (W:1352-1381), `question_set` (W:1383-1407) → `/lore/question` (:66).
**Рёбра** (`question_link`, W:1409-1433): ANSWERS — от KnowDecision к вопросу (`rel=answers` → `/lore/question/answers` :158, ставит closed); RAISED_IN → ADR, спринт или задача (`rel=raised_in` :213); GATES → KnowTask (`rel=gates` :258, свойство solved_at); BELONGS_TO → компонент (`rel=component` :295); BELONGS_TO_PROJECT (`rel=project` :338).

## 11. Релиз — KnowRelease (+KnowReleaseHist), PR — KnowPR
Ключ `release_uid = "<git_project>#<release_id>"`.
- **Поля:** `release_id` (обяз.), `git_project` (обяз. по REST, `LoreReleaseResource.java:200`), `release_date` (сегодня), `git_tag`, `type` (MCP: patch, minor, major; REST не проверяет), `description_md` (md), `week` (number), `is_current` (bool; не передан — ставится автоматически только при наличии тега, :143-147). Правка: `release_set` → `/lore/release/update` (:271), нужно хотя бы одно из git_tag, release_date, description_md, is_current (:319); `type` и `week` после создания через MCP не правятся. Подпись UI: «● ТЕКУЩИЙ» (`lore.releasesBoard.currentChip`).
- **Чтение:** `releases [project]` (S:2090), `releases_since {from}` (S:339), `timeline_releases` (S:326), `release_sprints {ruid}`, `release_sprints_by_tag {tag}`, `release_prs {ruid}`, `release_prs_by_tag {tag}`, `release_tasks_by_tag {tag}`, `release_decisions {tag}`. Среза по одному id не найдено.
- **Запись:** `release_new` (W:1458-1482) → `/lore/release` (:185); `release_set`; `release_link` (W:1510-1531) → `/lore/release/link` (:350); `release_unlink` → `/lore/release/unlink` (:493); `release_mv` → `/lore/project/move` (:563).
- **Рёбра:** BELONGS_TO_PROJECT синхронизируется с `git_project` (:255, :606); входящие IMPLEMENTED_IN_RELEASE ← KnowSprint, KnowADR; SHIPPED_IN ← KnowPR (`release_link rel=pr` создаёт KnowPR, :442) и ← Bragi*; HAS_STATE.

## 12. Веха — KnowMilestone (+KnowMilestoneHist)
- **Поля:** `milestone_id` (обяз.), `label`, `week` (number), `date_display` (text), `priority` (text), `goal_md` (SCD2, md). Правка — `milestone_set` (неотправленные поля не затираются). `decisions_md` есть в истории, пути записи не найдено (S:1436). Подписи: «Веха» (`lore.sprintDetail.plan.milestone`), «метка» (`lore.milestoneManager.placeholder.label`).
- **Чтение:** `milestones` (S:1433), `roadmap {code}` (S:1455).
- **Запись:** `milestone_new`/`milestone_set` (W:1033-1076) → `/lore/milestone`, `upsertMilestone` (`LoreMilestoneResource.java:299-366`).
- **Рёбра:** TARGETS_PRODUCT → продукт (`milestone_link` → `/lore/milestone/product` :111); входящие TARGETS_MILESTONE ← спринт (`sprint_link rel=milestone` → :34; `milestone_sprints` → :184) и ← UC (`feature_link rel=milestone`); ON_MILESTONE ← PlanCheckpoint.

## 13. Компонент — LoreComponent
Подпись: «Компонент».
- **Поля:** `component_id` (обяз.), `full_name`, `area` (синхронно с ребром IN_AREA), `team`, `game_icon`, `owner`, `parent_id` (синхронно с PARENT_OF). Правка — `component_set`.
- **Чтение:** `component {id}` (S:1642), `components [root]` (S:1626), `components_in_area {code}` (S:2441), `component_sprints {pattern, cid}` (S:1657), `use_cases_of_component {component}` (S:877).
- **Запись:** `component_new` (W:1877-1895) → `/lore/component/create` (:86); `component_set` (W:2139-2160) → `/lore/component/update` (:31); `component_del` → `/lore/component/delete` (:174), только без зависимостей.
- **Рёбра:** PARENT_OF — от дочернего к родителю (гипотеза по срезу: `in('PARENT_OF')` = дети, S:1628); IN_AREA → KnowDictEntry; USES → LoreTechnology; IN_PRODUCT → продукт (`product_link rel=component`, роль owner|consumer); DOCUMENTED_IN → KnowSpec; входящие BELONGS_TO ← ADR, решение, вопрос, спринт, QG, док, спека, UC; TAGGED_WITH ← задача.

## 14. Git-проект — KnowGitProject
- **Поля:** `slug` (обяз.), `name`, `hosts` (JSON-строка: remote, role primary|mirror, base_url, шаблоны), `default_branch`. `is_private` читается (S:1623), MCP не пишет. Правка — `project_new` (upsert).
- **Чтение:** `git_projects` (S:1622), `user_project_roles`, `project_users`, `projects_without_role`, `project_role_events`.
- **Запись:** `project_new` (W:2225-2256) → `/lore/project` (`LoreProjectResource.java:49`); `project_role_set` (W:2261-2280) → `/lore/user/role`, ребро HAS_PROJECT_ROLE от KnowUser к проекту.
- **Рёбра:** входящие BELONGS_TO_PROJECT от спринта, ADR, решения, вопроса, релиза, спеки, дока, ранбука, UC, KnowProjectActor, продукта.

## 15. Продукт — KnowDictEntry (dict_type = product)
- **Поля:** `code`, `label_ru`, `label_en`, `color`, `icon`, `sort_order`, `is_active`, `is_extensible`. Запись — `dict_set` (W:2283-2305) → `/lore/dict/entry` (`LoreDictResource.java:40`). История — KnowDictEntryHist, срез `history_dict {dict_type, code}`.
- **Чтение:** `products` (S:2397), `product_sprints {code}`, `roadmap {code}`.
- **Рёбра** (`product_link`, W:1900-1932 → `/lore/product/link`, `LoreProductAxisResource.java:52`): IN_PRODUCT от компонента (`rel=component`, role owner|consumer); PARENT_PRODUCT (`rel=parent`); BELONGS_TO_PROJECT (`rel=project`, role); SERVES (`rel=serves`, kind обязателен: count|sell|support, :70-71).

## 16. Сценарий и фича — KnowUseCase (один тип, PL-28)
Подписи: «US», «Фича» (`shell.hit.useCase`, `shell.hit.feature`).

| Поле | Подпись | Вид | Обяз. | Правка |
|---|---|---|---|---|
| uc_id (feature_id) | — | text | да | нет |
| title | — | text | нет | uc_new / feature_new (upsert) |
| scenario_md | «Сценарий» (`lore.product.us.scenario`) | md, шаблон Кокберна | нет | uc_new |
| acceptance_md | «Приёмка» (`lore.product.us.acceptance`) | md | нет | uc_new |
| body_md, context_md | — | md | нет | feature_new |
| status | — (подсказка `lore.product.us.statusHint`) | вручную proposed, dropped; active, shipped, in_rework вычисляются | нет | uc_new / feature_new |
| goal_level | «Уровень цели (Кокберн)» (`lore.product.us.goalLevel`) | cloud, kite, sea-level, subfunction (словарь uc_goal_level); фича — только cloud, kite | нет | то же |
| rigor | «Вес изложения» (`lore.product.us.rigor`) | casual, fully-dressed | нет | uc_new |
| priority | — | high, normal, low | нет | uc_new |
| parent_uc_id (ребро DECOMPOSES_INTO) | «Фича» (`lore.product.us.feature`) | ref UC, цикл → 400 | нет | uc_new |
| component_id | «Компонент» (`lore.product.feat.component`) | ref | нет | feature_new / uc_link |
| shipped_at, date_created | — | система | — | — |

**Чтение:** `uc_by_id {id}` (S:625), `features [component]` (S:835, корни cloud и kite), `use_cases_of_feature {id}` (S:887), `use_cases_of_component {component}` (S:877), `tasks_of_uc {id}` (S:987), `uc_actors`, `feature_vp_analytics`, `strategic_coverage`. MCP `uc_quality` → `/lore/uc/quality`, `/lore/uc/quality/all`.
**Запись:** `uc_new` (W:585-626) → `/lore/uc` (`LoreProductResource.java:195`); `feature_new` (W:554-583) → `/lore/feature` (:131).
**Рёбра:** `uc_link` (W:734-761 → `/lore/uc/link`, :1380): REALIZES от задачи (`rel=task`); TRACED_TO → ADR/решение (`rel=adr`, `rel=decision`); HAS_ACTOR → KnowProjectActor (`rel=actor`, actor_role primary|supporting); BELONGS_TO (`rel=component`), BELONGS_TO_PROJECT (`rel=project`); UC_INCLUDES, UC_EXTENDS; RELIEVES → pain, DELIVERS → gain, PERFORMS → job. `feature_link` (W:714-732 → `/lore/feature/link`, :1296): ADDRESSES → pain, PROMISES → gain, HELPS_WITH → job; TARGETS_MILESTONE → веха; BELONGS_TO → компонент; BUILDS_ON → UC (на себя → 400). DECOMPOSES_INTO — от родителя к ребёнку (`parent_uc_id`).

## 17. Проектный актор — KnowProjectActor
Подпись: «Клиент».
- **Поля:** `actor_id` (обяз.), `name` («Название», `lore.product.actor.name`), `kind` («Вид», `lore.product.actor.kind`; human-role, system, automation; `agent` отклоняется, `LoreProductResource.java:566, 598`), `body_md`, `project`/`projects` («Проекты»; `projects` заменяет весь набор).
- **Чтение:** `actors [kind]` (S:963), `uc_actors`, `actor_pairs`, `actor_load`.
- **Запись:** `project_actor_new` (W:856-887) → `/lore/project-actor` (:587); тот же `actor_id` у KnowActor → 400.
- **Рёбра:** BELONGS_TO_PROJECT; входящие HAS_ACTOR ← UC, FELT_BY ← pain, DESIRED_BY ← gain, PERFORMED_BY ← job, FILLS_ROLE ← KnowActor.

## 18. Личность агента — KnowActor
- **Поля:** `actor_id` (обяз.), `name`, `kind` (human-role, system, agent; `LoreProductResource.java:396-397`), `body_md`, `project`/`projects`, `machine_id`, `session_id`; `client_id`, `agent_role` есть в схеме (`LoreSchemaMigrations`).
- **Чтение:** `agent_owners`, `agent_sessions`, `actor_identity_orphans`.
- **Запись:** `actor_new` (W:810-846) → `/lore/actor` (:386); `actor_link` rel=fills_role (W:895-912) → `/lore/actor/link` (:1001), FILLS_ROLE → KnowProjectActor; `agent_session_log` (W:922-953) → `/lore/actor/session` (:742), KnowAgentSession + LOGGED_BY. Владелец — только REST `/lore/actor/owner` (:929), ребро OWNED_BY.

## 19–21. Боль, выгода, работа — KnowPain, KnowGain, KnowJob
Подписи: «Боль», «Ожидание», «Работа»; поля формы — `lore.product.vp.*`.
- **pain:** `pain_id` (обяз.), `title` («Заголовок»), `body_md` («Описание»), `severity` («Острота»: high, normal, low, `LoreProductResource.java:1126`). `pain_new` (W:631-648) → `/lore/pain` (:1116). Срез `pains [severity]` (S:923).
- **gain:** `gain_id` (обяз.), `title`, `body_md`, `metric_md` («Метрика — чем измерим…»), `rank` («Ранг (Kano)»: essential, expected, desired, unexpected, :92). `gain_new` (W:650-669) → `/lore/gain` (:1150). Срез `gains [rank]` (S:935).
- **job:** `job_id` (обяз.), `title`, `body_md`, `kind` («Тип работы (Остервальдер)»: functional, social, emotional, supporting, :89), `importance` («Важность»: high, normal, low). `job_new` (W:675-694) → `/lore/job` (:1078). Срез `jobs [kind]` (S:949). Вершина глобальная, без проекта.
- **Рёбра** (`vp_link`, W:696-712 → `/lore/vp/link`, :1199): FELT_BY (боль → актор), DESIRED_BY (выгода → актор), PERFORMED_BY (работа → актор), BLOCKS (боль → работа), SUCCESS_OF (выгода → работа). Со стороны UC: ADDRESSES, PROMISES, HELPS_WITH, RELIEVES, DELIVERS, PERFORMS (§16).
- Статусов нет. Правка — повторным `*_new` (upsert).

## 22. Quality Gate — QualityGate; QGJobTask; QGRecommendation; прогоны
- **QG:** `qg_id` (обяз.), `name` (MCP обяз.), `description`, `component_id` (дублируется ребром BELONGS_TO), `status` (свободный текст), `content_md`, `sprint_id`; `last_run_status` только читается. `qg_new` (W:1688-1705) → `/lore/quality-gate` (`LoreQgResource.java:30`). Срезы: `quality_gate_by_id {id}` (S:1922), `quality_gates` (S:1914), `qg_metrics {qg_id}` (QGMetric через MEASURED_BY).
- **QGJobTask:** `job_id`, `qg_id` обязательны (:129-131); `inv_id`, `run_date`, `severity` (blocker, major, minor), `status` (open, resolved), `note_md`. `qg_job_new` → `/lore/qg/job-task` (:121); ребро YIELDED от QG (:154). Срезы `qg_job_tasks`, `qg_violations`.
- **rec (QGRecommendation):** `rec_id`, `job_id`, `title` обязательны (MCP; REST проверяет rec_id и job_id, :182-184); `status` (pending, dismissed, promoted), `priority` (P0, P1, P2), `severity` (critical, high, medium, low), `effort_days`, `tags`, `component_id`, `qg_id`, `inv_id`, `fix_cmd`, `how_to_verify`, `body_md`. `rec_new` → `/lore/qg/recommendation` (:174), ребро PRODUCED от QGJobTask (:218). `rec_promote` → `/lore/qg/promote` (:245): создаёт задачу, PROMOTED_TO → KnowTask (:404), при необходимости спринт SPRINT_QG_HOUSEKEEPING_<неделя>.
- **Прогон (ClRoutineRun, ClRoutineMetric):** `qg_run_log` (W:2044-2110) → `/lore/qg/run` (:95). Статус прогона: OK, WARN, FAIL, PARTIAL; метрики: PASS, WARN, FAIL, SKIP, NOT_MEASURED (для NOT_MEASURED и SKIP обязателен `not_measured_reason`). Срезы: `qg_routine_runs`, `qg_run_metrics {run_id}`, `qg_metrics_latest`, `qg_run_history {routine_name}`, `routine_*`.

## 23. Находка — KnowFinding (+KnowFindingHist)
- **Поля:** finding_id, type, verified, source_sprint, summary_md, evidence_md (S:2077, 2085).
- **Чтение:** `finding_by_id {id}`, `findings [type]`.
- **Запись:** через MCP и REST-эндпоинты не найдена; только ingest markdown (`LoreIngestService.java:526-552`, вход `POST /admin/lore/ingest`, `AidaLoreResource.java:1241`).

## 24. BRAGI
Запись для всех подтипов — upsert, неотправленные поля не затираются. REST — `LoreBragiResource.java`.
- **BragiPublication:** `publication_id` (обяз., :78), `title`, `topic`, `main_text_md`, `type`, `status_general` (свободный текст: draft, ready, published), `annotation_md`, `todo_md`, `keyword_ids` (TARGETS_KEY, только добавление), `rubric_id` (IN_RUBRIC, заменяет). `bragi_pub_new` (W:2322-2345) → `/lore/bragi/publication` (:70). Срезы `bragi_publications` (S:2211), `bragi_overview`. Подписи формы — `bragi.publicationEditor.*` (58 ключей).
- **BragiVariant:** `variant_id` (обяз.), `publication_id` (HAS_VARIANT от публикации), `channel_id` (IN_CHANNEL), `text_md`, `status` (свободный текст), `url`, `published_at`, `asset_id` (HAS_ASSET), `annotation_md`, `todo_md`. `bragi_variant_new` → `/lore/bragi/variant` (:124). Срез `bragi_calendar`.
- **BragiCampaign:** `campaign_id`, `utm_*`, `target_url`, `period`, `variant_id` (FOR_VARIANT). `bragi_campaign_new` → `/lore/bragi/campaign` (:511). Среза чтения не найдено.
- **Channel, Rubric, Keyword, Page, Asset, Integration:** `bragi_channel_set` (:342), `bragi_rubric_set` (:375), `bragi_keyword_set` (:286; TARGETS_PAGE, IN_RUBRIC), `bragi_page_set` (:475), `bragi_asset_attach` (:184), `bragi_asset_up` (:238), `bragi_integration_new` (:744; `secret_ref` — только ссылка на секрет). Срезы `bragi_channels`, `bragi_rubrics`, `bragi_keys`, `bragi_pages`, `bragi_integrations`, `bragi_competitors`.
- **insight (BragiInsight):** `insight_id`, `statement_md`, `insight_date`, `evidence_ref`, `subject_id`. `insight_new` → `/lore/bragi/insight` (:787); `insight_link` → `/lore/bragi/insight/link` (:820), LED_TO → KnowTask/KnowADR. Срез `bragi_insights` (S:2344).
- **Связи с рабочим графом:** `bragi_link` (W:2619-2653) → `/lore/bragi/link` (:560): PRODUCED_BY → задача/спринт, SHIPPED_IN → релиз; также `/lore/bragi/rubric/link` (:413).
- **metric (MetricSnapshot):** TIMESERIES, не вершина. Запись только добавлением: `metric_log` → `/lore/bragi/metric` (:631); `bragi_sync` (:862). Чтение: `metric_get` → `/lore/bragi/metric/query` (:674), срез `bragi_analytics`. Тот же ряд хранит `lore.requests`, `lore.action`, `lore.login` (S:2289-2334).

## 25. Чего не найдено (искал в `LoreSlices.java` и `Lore*Resource.java`)
- Среза по одному id для sprint (только `sprint_tree`), task (только `tasks_by_uids`), release, milestone, pain, gain, job, project actor, BRAGI-публикации.
- Путей записи для PlanCheckpoint, KnowFinding, `decision.supersedes`, `rationale_md`, `milestone.decisions_md`.
- Русских подписей большинства полей (task, decision, spec, doc, release) в `common.json`. Гипотеза: захардкожены в TSX (`LoreSprintDetail.tsx`, `LoreDecisionBoard.tsx`, `LoreSpecView.tsx` и др.) — не проверялось.
