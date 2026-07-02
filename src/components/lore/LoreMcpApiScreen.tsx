// LoreMcpApiScreen — published API reference for the `aida-lore` MCP server.
// Lives at /lore?section=mcp. Documents the LORE write/read tools, the backend
// contract, env and runbook, and pings the live backend to show health + the
// real slice catalog that `lore_list_slices` exposes. bench_* (MUNINN) tools
// live on the same server but are documented on /benchmark?tab=mcp instead.
import { Fragment, useEffect, useState } from 'react';
import { fetchLoreSliceCatalog, type LoreSliceDescriptor } from '../../api/lore';

interface ToolDoc {
  name: string;
  kind: 'read' | 'write';
  entity: string;
  backend: string;
  params: string;
  desc: string;
}

/**
 * Split a params string like "a, b?, c[]" into [{name, optional}] for readable rendering.
 * Some tools document an alternate batch-call shape after "|" (e.g. "a, b | items: [{a, b}]") —
 * that's prose for the description column, not additional param chips, so only the part
 * before the first "|" is split into chips.
 */
function splitParams(params: string): { name: string; optional: boolean }[] {
  if (params === '—') return [];
  return params.split('|')[0].split(',').map(p => {
    const t = p.trim();
    return { name: t, optional: t.includes('?') };
  });
}

const TOOLS: ToolDoc[] = [
  // ── Read ──────────────────────────────────────────────────────────────────
  { name: 'lore_list_slices', kind: 'read', entity: 'Meta', backend: 'GET /lore/slices', params: '—',
    desc: 'Каталог всех именованных слайсов (read-запросов) с их обязательными/опциональными параметрами. Вызывать первым — задаёт, что вообще можно прочитать через lore_query_slice.' },
  { name: 'lore_query_slice', kind: 'read', entity: 'Meta', backend: 'GET /lore/slice/{slice}', params: 'slice, params?',
    desc: 'Выполнить один слайс из каталога lore_list_slices и получить rows[]. params — map строк-значений: {"id":"ADR-FE-001"}, {"sprint_id":"SPRINT_X"} и т.п. Сам SQL и whitelisting полей — на бэкенде, клиент их не видит.' },

  // ── Sprint (KnowSprint) ──────────────────────────────────────────────────
  { name: 'lore_create_sprint', kind: 'write', entity: 'Sprint', backend: 'POST /lore/sprint/create',
    params: 'sprint_id, name, status?, item_id?, plan_id?, priority?, outcome_md?, context_md?',
    desc: 'KnowSprint: создать напрямую, без plan-item. Идемпотентен — upsert по sprint_id. Сеет начальную открытую KnowSprintHist-строку (HAS_STATE).' },
  { name: 'lore_register_sprint', kind: 'write', entity: 'Sprint', backend: 'POST /lore/sprint',
    params: 'item_id, sprint_id?, name?, status?',
    desc: 'KnowSprint: зарегистрировать реальный спринт для уже существующего placeholder plan-item — создаёт вершину и линкует REPRESENTS (бар на доске «План» переключается с плейсхолдера на спринт). Использовать вместо lore_create_sprint, когда plan-item уже заведён.' },
  { name: 'lore_update_sprint', kind: 'write', entity: 'Sprint', backend: 'POST /lore/sprint/update',
    params: 'sprint_id, name?, outcome_md?, context_md?, priority?, plan_id?, effort_days?',
    desc: 'KnowSprint: частичное обновление метаданных — пишутся только переданные поля, остальные не трогаются. Статус этим тулом не меняется (для статуса, вкл. soft-delete через status="cancelled" — lore_set_status). Правило: всегда заполнять context_md, если известно, зачем спринт существует.' },
  { name: 'lore_update_sprint_refs', kind: 'write', entity: 'Sprint', backend: 'POST /lore/sprint/refs',
    params: 'sprint_id, pr_numbers[], git_project?',
    desc: 'KnowSprintHist: добавить номера PR в поле pr_refs открытой hist-строки спринта. Уже присутствующие номера пропускаются. Возвращает итоговый pr_refs и сколько добавлено.' },
  { name: 'lore_link_sprint_project', kind: 'write', entity: 'Sprint', backend: 'POST /lore/sprint/project',
    params: 'sprint_id, git_project, action?',
    desc: 'Ребро BELONGS_TO_PROJECT (KnowSprint → KnowGitProject) — спринт может относиться к нескольким репозиториям сразу. action = add | remove, идемпотентно на add.' },
  { name: 'lore_link_sprint_dep', kind: 'write', entity: 'Sprint', backend: 'POST /lore/sprint/dep',
    params: 'from_sprint, to_sprint, kind?, reason?, action?',
    desc: 'Ребро DEPENDS_ON между двумя спринтами (from_sprint зависит от to_sprint). kind = hard (блокирует деплой) | soft (координация) | gate (go/no-go) | informs (просто в курсе). Сервер отклоняет рёбра, создающие цикл. action = add | remove.' },
  { name: 'lore_link_sprint_component', kind: 'write', entity: 'Sprint', backend: 'POST /lore/sprint/component',
    params: 'sprint_id, component_id, action?',
    desc: 'Явное ребро BELONGS_TO (спринт → компонент) — перекрывает нечёткий матч по имени (sprint_id LIKE %component_key%) в слайсе component_sprints и на бейджах модулей в паспорте спринта. action = add | remove.' },
  { name: 'lore_link_sprint_milestone', kind: 'write', entity: 'Sprint', backend: 'POST /lore/milestone/sprint',
    params: 'sprint_id, milestone_id, action?',
    desc: 'Прямое ребро TARGETS_MILESTONE (спринт → веха) — для спринтов без PlanItem-моста (большинство). Если у спринта есть PlanItem, предпочтительнее lore_update_plan_item (путь через CONTRIBUTES_TO). action = add | remove.' },

  // ── Status (SCD2-переходы, общие для нескольких типов) ────────────────────
  { name: 'lore_set_status', kind: 'write', entity: 'Status', backend: 'POST /lore/status',
    params: 'entity_type, id, status',
    desc: 'Сменить статус одной сущности через полный SCD2-переход: закрыть текущую открытую hist-строку (valid_to=now), открыть новую. entity_type = plan_item | sprint | task | checkpoint | phase. status ∈ todo|planned|active|partial|done|blocked|high|cancelled|backlog|design|ready_for_deploy — status="cancelled" это и есть штатный soft-delete для этих типов, отдельного hard-delete тула для них нет и не планируется.' },
  { name: 'lore_batch_set_status', kind: 'write', entity: 'Status', backend: 'POST /lore/status/batch',
    params: 'entity_type, ids[], status',
    desc: 'То же самое (SCD2-переход), но сразу для списка id одного entity_type. Ошибки собираются по каждому элементу отдельно и не прерывают остальные. Возвращает {ok, updated, errors[]}.' },

  // ── Task (KnowTask) ────────────────────────────────────────────────────────
  { name: 'lore_create_task', kind: 'write', entity: 'Task', backend: 'POST /lore/task',
    params: 'sprint_id, task_id, title, note_md?, phase_uid?',
    desc: 'KnowTask: создать задачу в спринте (order_index = max по спринту + 1, стартовый статус PLANNED с открытой hist-строкой). phase_uid — опционально сразу привязать к фазе тем же вызовом (ребро IN_PHASE); фаза должна уже существовать (lore_create_phase) и принадлежать тому же спринту.' },
  { name: 'lore_edit_task', kind: 'write', entity: 'Task', backend: 'POST /lore/task/edit',
    params: 'task_uid, title, note_md?, effort_days? | tasks: [{task_uid, title, note_md?, effort_days?}]',
    desc: 'KnowTask: изменить заголовок/заметку/оценку трудозатрат существующей задачи (обновляется и вершина, и её открытая hist-строка). Одиночный режим — task_uid+title в аргументах напрямую; batch-режим — массив tasks[] за один вызов, ошибки собираются по элементу, не прерывая остальные.' },
  { name: 'lore_link_task_component', kind: 'write', entity: 'Task', backend: 'POST /lore/task/component',
    params: 'task_uid, component_id, action?',
    desc: 'Ребро TAGGED_WITH между задачей и компонентом, many-to-many — у одной задачи может быть 0..N меток. action = add | remove.' },
  { name: 'lore_link_task_phase', kind: 'write', entity: 'Task', backend: 'POST /lore/task/phase',
    params: 'task_uid, phase_uid?, action?',
    desc: 'Ребро IN_PHASE (задача → фаза), задача и фаза обязаны принадлежать одному спринту. Слайс tasks_of_phase читает именно это ребро. action = add | remove; remove без phase_uid отвязывает задачу от ВСЕХ фаз сразу.' },

  // ── Phase (KnowPhase) ──────────────────────────────────────────────────────
  { name: 'lore_create_phase', kind: 'write', entity: 'Phase', backend: 'POST /lore/phase',
    params: 'sprint_id, phase_key, name?, order_index?',
    desc: 'KnowPhase: создать фазу спринта. phase_uid = "<sprint_id>/PHASE_<KEY>", ребро PART_OF → спринт, стартовый статус PLANNED в KnowPhaseHist. Идемпотентно — повторный вызов с тем же phase_key возвращает существующую фазу (created=false), ничего не меняя. Статус фазы (вкл. soft-delete) — через lore_set_status с entity_type="phase".' },

  // ── Milestone (KnowMilestone) ────────────────────────────────────────────
  { name: 'lore_create_milestone', kind: 'write', entity: 'Milestone', backend: 'POST /lore/milestone',
    params: 'milestone_id, label?, week?, date_display?, goal_md?, priority?',
    desc: 'KnowMilestone: создать веху (upsert по milestone_id). Партиальные вызовы безопасны — непереданные поля не обнуляются. goal_md пишется в открытую KnowMilestoneHist-строку (создаётся при первом заполнении), остальные поля — на вершину.' },
  { name: 'lore_update_milestone', kind: 'write', entity: 'Milestone', backend: 'POST /lore/milestone',
    params: 'milestone_id, label?, week?, date_display?, goal_md?, priority?',
    desc: 'KnowMilestone: тот же эндпоинт, что и lore_create_milestone, для точечной правки существующей вехи — например, только goal_md, не трогая label/week. Спринты к вехе привязываются отдельно — lore_link_sprint_milestone (прямое ребро) или lore_update_plan_item (через PlanItem-мост).' },

  // ── Plan item ────────────────────────────────────────────────────────────
  { name: 'lore_update_plan_item', kind: 'write', entity: 'Plan item', backend: 'POST /lore/plan-item/milestone',
    params: 'item_id, milestone_id?, action?',
    desc: 'Ребро CONTRIBUTES_TO (PlanItem → Milestone). Канонический путь привязки спринта к вехе, когда у спринта есть plan-item (цепочка Milestone ← CONTRIBUTES_TO ← PlanItem → REPRESENTS → KnowSprint). action="remove" без milestone_id снимает вообще все привязки этого plan-item к вехам.' },

  // ── ADR (KnowADR) ─────────────────────────────────────────────────────────
  { name: 'lore_create_adr', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr',
    params: 'adr_id, name, status?, date_created?, component_id?, component_ids?, context_md?, decision_md?, consequences_md?, depends_on_ids?, supersedes_ids?, tags?, file_path?',
    desc: 'KnowADR: создать или дописать (upsert по adr_id). Полная SCD2-структура — вершина + открытая KnowADRHist + ребро HAS_STATE; тело (context_md/decision_md/consequences_md) читается именно из hist-строки. Частичные вызовы безопасны — непереданные поля не обнуляются. depends_on_ids/supersedes_ids/component_ids/tags при передаче ПОЛНОСТЬЮ заменяют набор рёбер этого типа, а не дополняют его.' },
  { name: 'lore_update_adr', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr',
    params: 'adr_id, name, status?, date_created?, component_id?, component_ids?, context_md?, decision_md?, consequences_md?, depends_on_ids?, supersedes_ids?, tags?, file_path?',
    desc: 'KnowADR: тот же эндпоинт, что и lore_create_adr, но сигнатура заточена под точечную правку существующего ADR — например, передать только decision_md, чтобы поправить один раздел, не трогая остальные. name всё ещё обязателен параметром (бэкенд перезаписывает его на каждый вызов).' },
  { name: 'lore_link_adr_sprint', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr/link',
    params: 'adr_id, sprint_id, action?',
    desc: 'Ребро IMPLEMENTED_IN (ADR → спринт-реализатор) — заполняет implemented_in_ids в слайсе adr. action = add | remove, идемпотентно на add. В ответе linked:true/false — false означает, что adr_id или sprint_id не найдены и ребро не создалось.' },
  { name: 'lore_link_adr_release', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr/link',
    params: 'adr_id, release_id, git_project?, action?',
    desc: 'Ребро IMPLEMENTED_IN_RELEASE (ADR → релиз) — заполняет release_ids в слайсе adr. С переданным git_project матчит релиз по release_uid (нужно для multi-repo). linked:false + hint в ответе, если релиз не найден.' },
  { name: 'lore_rename_adr', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr/rename',
    params: 'adr_id, new_adr_id',
    desc: 'KnowADR: переименовать по месту (меняется только adr_id на той же вершине). Все рёбра (DEPENDS_ON/SUPERSEDES/BELONGS_TO/TAGGED_WITH/IMPLEMENTED_IN*/HAS_STATE) висят на вершине по @rid и переживают переименование без перевешивания. Отказ, если new_adr_id уже занят. Упоминания старого id строкой в документах/.md — НЕ обновляются автоматически.' },
  { name: 'lore_delete_adr', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr/delete',
    params: 'adr_id',
    desc: 'KnowADR: БЕЗВОЗВРАТНО удалить (hard delete) — каскад рёбра → KnowADRHist-строки → вершина. Единственное намеренное исключение из общего правила «soft-delete через статус»: для реального ADR вместо удаления всегда предпочесть status=DEPRECATED/SUPERSEDED через lore_update_adr; hard-delete — только для тестовых артефактов и ошибочных созданий.' },

  // ── Decision (KnowDecision) ──────────────────────────────────────────────
  { name: 'lore_create_decision', kind: 'write', entity: 'Decision', backend: 'POST /lore/decision',
    params: 'decision_id, title, body_md?, date_created?, refs_raw?',
    desc: 'KnowDecision: создать или обновить (upsert по decision_id, частичные вызовы безопасны). Для фиксации разовых ключевых решений, принятых в ходе спринта или дизайн-сессии — не заменяет ADR, а дополняет их для менее формальных вердиктов.' },

  // ── Spec (KnowSpec) ───────────────────────────────────────────────────────
  { name: 'lore_create_spec', kind: 'write', entity: 'Spec', backend: 'POST /lore/spec',
    params: 'spec_id, title, version?, component_id?, content_md?, summary?, file_path?',
    desc: 'KnowSpec: создать или дописать (upsert по spec_id), с SCD2-историей. Body-поля (content_md/version/summary) пишутся в открытую KnowSpecHist-строку (создаётся, если её ещё нет) — именно её читает слайс spec_by_id, не вершину напрямую. Частичные вызовы безопасны — непереданные поля не обнуляются.' },
  { name: 'lore_update_spec', kind: 'write', entity: 'Spec', backend: 'POST /lore/spec',
    params: 'spec_id, title, version?, component_id?, content_md?, summary?, file_path?',
    desc: 'KnowSpec: тот же эндпоинт, что и lore_create_spec, сигнатура под точечный amend (зеркало lore_update_adr) — например, только version, чтобы поднять версию спеки без пересылки всего тела. title обязателен на каждый вызов.' },
  { name: 'lore_delete_spec', kind: 'write', entity: 'Spec', backend: 'POST /lore/spec/delete',
    params: 'spec_id',
    desc: 'KnowSpec: безвозвратно удалить вершину по spec_id (hard delete — у KnowSpec нет статусного поля для soft-delete).' },

  // ── QualityGate ───────────────────────────────────────────────────────────
  { name: 'lore_create_quality_gate', kind: 'write', entity: 'QualityGate', backend: 'POST /lore/quality-gate',
    params: 'qg_id, name, description?, component_id?, status?, content_md?, sprint_id?',
    desc: 'QualityGate: создать или обновить (upsert по qg_id, частичные вызовы безопасны) — сам гейт как вершину, с текстом инвариантов в content_md. Soft-delete гейта — status="deprecated"/"archived". Прогоны и метрики к этой вершине пишет отдельно lore_record_qg_run.' },

  // ── Runbook (KnowRunbook) ─────────────────────────────────────────────────
  { name: 'lore_create_runbook', kind: 'write', entity: 'Runbook', backend: 'POST /lore/runbook',
    params: 'runbook_id, name, area?, date_created?, content_md?',
    desc: 'KnowRunbook: создать или обновить (upsert по runbook_id, частичные вызовы безопасны) — операционный плейбук/инструкция (area: recovery, infra, deploy, ops, auth, db, service…).' },

  // ── Doc (KnowDoc) ─────────────────────────────────────────────────────────
  { name: 'lore_create_doc', kind: 'write', entity: 'Doc', backend: 'POST /lore/doc',
    params: 'doc_id, title, kind?, has_ext_deps?, component_id?, file_path?, content_html?',
    desc: 'KnowDoc: создать или обновить (upsert по doc_id, частичные вызовы безопасны) — произвольный HTML-документ или фрагмент (страница, гайд, справка…). content_html ограничен 100 КБ.' },

  // ── QG-рутина: прогон → job-task → рекомендация → задача ──────────────────
  { name: 'lore_record_qg_run', kind: 'write', entity: 'QG-flow', backend: 'POST /lore/qg/run',
    params: 'routine_name, run_date, status, metrics[]?, started_at?, finished_at?, flags?, run_id?',
    desc: 'ClRoutineRun + ClRoutineMetric: записать результат завершённого прогона QG-рутины. Вызывать один раз в конце каждого прогона. metrics[] — SMART-метрики по ADR-QG-002: каждая несёт key/value/unit/target/status/source (source — команда-репродьюсер + file:line evidence, на неё опирается lore_create_recommendation).' },
  { name: 'lore_create_qg_job_task', kind: 'write', entity: 'QG-flow', backend: 'POST /lore/qg/job-task',
    params: 'job_id, qg_id, inv_id?, run_date?, severity?, status?, note_md?',
    desc: 'QGJobTask: upsert + ребро YIELDED от родительской QualityGate. Вызывать, когда конкретный инвариант провалился (FAIL). Если позже приходит PASS по тому же qg_id+inv_id — открытые job-task для этой пары автоматически закрываются как resolved.' },
  { name: 'lore_create_recommendation', kind: 'write', entity: 'QG-flow', backend: 'POST /lore/qg/recommendation',
    params: 'rec_id, job_id, title, body_md?, status?, priority?, severity?, effort_days?, tags?, component_id?, qg_id?, inv_id?, fix_cmd?, how_to_verify?',
    desc: 'QGRecommendation: upsert + ребро PRODUCED от родительской QGJobTask — предложение, как исправить провалившийся инвариант. Статус стартует как pending и ждёт подтверждения пользователем (lore_promote_recommendation). Пустая рекомендация бесполезна — стараться заполнять priority/severity/effort_days/fix_cmd/how_to_verify.' },
  { name: 'lore_promote_recommendation', kind: 'write', entity: 'QG-flow', backend: 'POST /lore/qg/promote',
    params: 'rec_id, sprint_id?, task_uid?, title?, note_md?',
    desc: 'QGRecommendation → KnowTask: подтвердить рекомендацию, создать задачу и ребро PROMOTED_TO, пометить рекомендацию как promoted. По умолчанию задача уходит в недельный ротирующийся спринт SPRINT_QG_HOUSEKEEPING_<ISO-неделя> (авто-создаётся при первом использовании за неделю, виден на доске «План»); явный sprint_id — override. note_md, если не передан, бэкенд сам собирает из полей рекомендации. Вызывать только после явного «да» от пользователя.' },

  // ── Component (LoreComponent) ─────────────────────────────────────────────
  { name: 'lore_create_component', kind: 'write', entity: 'Component', backend: 'POST /lore/component/create',
    params: 'component_id, full_name?, area?, team?, game_icon?, owner?, parent_id?',
    desc: 'LoreComponent: создать новый компонент (upsert по component_id). Для компонентов, которых в графе ещё нет — если компонент уже существует, использовать lore_update_component, а не пересоздавать.' },
  { name: 'lore_update_component', kind: 'write', entity: 'Component', backend: 'POST /lore/component/update',
    params: 'component_id, full_name?, area?, team?, game_icon?, owner?, parent_id?',
    desc: 'LoreComponent: частичное обновление существующего компонента — переименование, смена владельца/команды/иконки, репарент. Пишутся только переданные поля. Новый компонент этим тулом не создать.' },

  // ── Release (KnowRelease) ──────────────────────────────────────────────────
  { name: 'lore_create_release', kind: 'write', entity: 'Release', backend: 'POST /lore/release',
    params: 'release_id, release_date?, git_tag?, type?, description_md?, is_current?, week?, git_project?',
    desc: 'KnowRelease: создать вершину релиза. is_current=true автоматически снимает флаг с предыдущего текущего релиза того же git_project. Сеет KnowReleaseHist + ребро HAS_STATE.' },
  { name: 'lore_update_release', kind: 'write', entity: 'Release', backend: 'POST /lore/release/update',
    params: 'release_id, git_tag?, release_date?, description_md?, is_current?, git_project?',
    desc: 'KnowRelease: частичное обновление существующего релиза — пишутся только переданные поля. Удобно, чтобы дописать description_md/git_tag уже после того, как релиз вышел.' },
  { name: 'lore_link_release', kind: 'write', entity: 'Release', backend: 'POST /lore/release/link',
    params: 'release_id, sprint_ids[], git_project',
    desc: 'Ребро IMPLEMENTED_IN_RELEASE (KnowSprint → KnowRelease) — прикрепить один или несколько спринтов к релизу. Вызывать, когда спринт завершён и реально вошёл в конкретный релиз. Для привязки PR — lore_link_release_pr. Всегда передавать git_project (multi-repo: release_uid = "{git_project}#{release_id}").' },
  { name: 'lore_link_release_pr', kind: 'write', entity: 'Release', backend: 'POST /lore/release/link',
    params: 'release_id, pr_numbers[], git_project',
    desc: 'Ребро SHIPPED_IN (KnowPR → KnowRelease, с upsert вершин KnowPR) — прикрепить один или несколько PR к релизу. Для привязки спринтов — lore_link_release. Всегда передавать git_project.' },
  { name: 'lore_unlink_release', kind: 'write', entity: 'Release', backend: 'POST /lore/release/unlink',
    params: 'release_id, git_project, sprint_ids?, pr_numbers?',
    desc: 'Убрать рёбра IMPLEMENTED_IN_RELEASE (спринт→релиз) и/или SHIPPED_IN (PR→релиз) — для исправления случайных двойных привязок.' },
  { name: 'lore_move_to_project', kind: 'write', entity: 'Release', backend: 'POST /lore/project/move',
    params: 'entity_type, id, git_project',
    desc: 'Исправить git_project у PR или релиза, ошибочно привязанного не к тому репозиторию: перевешивает ребро BELONGS_TO_PROJECT, обновляет pr_uid или release_uid. entity_type = pr | release.' },
];

const ENV_ROWS: [string, string, string][] = [
  ['LORE_BACKEND_URL', 'http://localhost:9100', 'Базовый URL backend UnlimitedLORE'],
  ['LORE_SEER_ROLE',   'admin',                 'Заголовок X-Seer-Role для write-инструментов'],
];

const SMOKE = `cd C:/AIDA/UnlimitedLORE/mcp-server
printf '%s\\n' \\
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \\
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \\
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \\
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"lore_query_slice","arguments":{"slice":"plan_config"}}}' \\
 | node dist/index.js`;

const MCP_JSON = `{
  "mcpServers": {
    "aida-lore": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": {
        "LORE_BACKEND_URL": "http://localhost:9100",
        "LORE_SEER_ROLE": "admin"
      }
    }
  }
}`;

// Unique entities in TOOLS array order (already grouped by comment sections above).
const ENTITIES = Array.from(new Set(TOOLS.map(t => t.entity)));

export default function LoreMcpApiScreen() {
  const [slices, setSlices]   = useState<LoreSliceDescriptor[] | null>(null);
  const [health, setHealth]   = useState<'checking' | 'up' | 'down'>('checking');
  const [filter, setFilter]   = useState('');
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [kindFilter, setKindFilter]     = useState<'all' | 'read' | 'write'>('all');

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreSliceCatalog(ctrl.signal)
      .then(s => { setSlices(s); setHealth('up'); })
      .catch(() => { if (!ctrl.signal.aborted) setHealth('down'); });
    return () => ctrl.abort();
  }, []);

  const shownSlices = (slices ?? []).filter(s =>
    !filter || s.id.toLowerCase().includes(filter.toLowerCase()));

  const shownTools = TOOLS.filter(t =>
    (!entityFilter || t.entity === entityFilter) &&
    (kindFilter === 'all' || t.kind === kindFilter));

  return (
    <div style={S.scroll}>
      <div style={S.wrap}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={S.head}>
          <h1 style={S.h1}>MCP-сервер <span style={{ color: 'var(--acc)' }}>aida-lore</span></h1>
          <HealthPill health={health} count={slices?.length} />
        </div>
        <p style={S.lead}>
          Прямой доступ ИИ-агента (Claude Desktop / Claude Code / Cursor) к движку
          LORE по протоколу MCP: читать план / спринты / ADR / решения / релизы и
          писать статусы и задачи — без ручного SQL. Сервер — тонкая обёртка над
          backend <code style={S.code}>:9100</code>; вся композиция SQL-слайсов и
          whitelisting остаётся на сервере.
        </p>

        {/* ── Pipeline ───────────────────────────────────────────────────────── */}
        <div style={S.pipe}>
          <Node>Claude</Node><Arrow label="stdio" />
          <Node accent>aida-lore-mcp</Node><Arrow label="HTTP" />
          <Node>backend :9100</Node><Arrow label="REST" />
          <Node>ArcadeDB :2480</Node>
        </div>

        {/* ── Tools ──────────────────────────────────────────────────────────── */}
        <Section title={`Инструменты (${shownTools.length}${shownTools.length !== TOOLS.length ? ` из ${TOOLS.length}` : ''})`}>
          <div style={S.entityChips}>
            <span
              style={entityChipStyle(entityFilter === null)}
              onClick={() => setEntityFilter(null)}
            >Все</span>
            {ENTITIES.map(e => (
              <span
                key={e}
                style={entityChipStyle(entityFilter === e)}
                onClick={() => setEntityFilter(f => f === e ? null : e)}
              >{e} <span style={S.entityChipCount}>{TOOLS.filter(t => t.entity === e).length}</span></span>
            ))}
            <span style={S.kindToggle}>
              {(['all', 'read', 'write'] as const).map(k => (
                <span key={k} style={kindChipStyle(kindFilter === k)} onClick={() => setKindFilter(k)}>
                  {k === 'all' ? 'read+write' : k}
                </span>
              ))}
            </span>
          </div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <Th>Инструмент</Th><Th>Тип</Th><Th>Backend-вызов</Th><Th>Параметры</Th><Th>Назначение</Th>
                </tr>
              </thead>
              <tbody>
                {shownTools.map((t, i) => {
                  const prevEntity = i > 0 ? shownTools[i - 1].entity : null;
                  const isNewGroup = t.entity !== prevEntity;
                  return (
                    <Fragment key={t.name}>
                      {isNewGroup && (
                        <tr style={S.trGroup}>
                          <td colSpan={5} style={S.tdGroup}>{t.entity}</td>
                        </tr>
                      )}
                      <tr style={S.tr}>
                        <Td><code style={S.codeAcc}>{t.name}</code></Td>
                        <Td><KindTag kind={t.kind} /></Td>
                        <Td><code style={S.code}>{t.backend}</code></Td>
                        <Td>
                          <div style={S.paramList}>
                            {splitParams(t.params).map(p => (
                              <code key={p.name} style={p.optional ? S.paramOpt : S.paramReq}>{p.name}</code>
                            ))}
                            {t.params === '—' && <span style={{ color: 'var(--t3)' }}>—</span>}
                          </div>
                        </Td>
                        <Td style={{ color: 'var(--t2)' }}>{t.desc}</Td>
                      </tr>
                    </Fragment>
                  );
                })}
                {shownTools.length === 0 && (
                  <tr><td colSpan={5} style={{ ...S.td, color: 'var(--t3)', textAlign: 'center' }}>Ничего не найдено под текущим фильтром.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p style={S.note}>
            Write-инструменты идут с заголовком <code style={S.code}>X-Seer-Role: admin</code>,
            версионны (SCD2 — история не теряется) и мутируют общую{' '}
            <code style={S.code}>system_aida_lore</code> — применять осознанно.
            <code style={S.code}>lore_create_adr</code> создаёт полную SCD2-структуру:
            вершина + KnowADRHist (valid_to=null) + HAS_STATE edge — тело ADR читается
            именно из hist-строки.{' '}
            Партиальные (amend) вызовы у всех upsert-инструментов с 2026-07 безопасны — SQL SET
            собирается динамически, непереданное поле не трогается (раньше пропущенный параметр
            молча обнулялся).{' '}
            <b>Удаление:</b> штатный путь — soft-delete через статус (<code style={S.code}>lore_set_status</code>
            {' '}со status="cancelled"/"deprecated"/"archived" — история сохраняется). Настоящий
            hard-delete есть только у <code style={S.code}>lore_delete_adr</code> и{' '}
            <code style={S.code}>lore_delete_spec</code>, оба явно помечены как «только для
            тестовых артефактов». Остальные типы (Sprint/Task/Release/Component/Milestone/
            QualityGate/Runbook/Doc) осознанно без hard-delete тула — реальные данные не удаляются,
            только архивируются статусом.{' '}
            Из набора пока не реализован только <code style={S.code}>checkpoint</code> (бэкенд → 501).
            Инструменты по <b>Исследованиям</b> (витрина RAGVSDL) — на отдельной странице
            «MCP API» в разделе «Исследования» (<code style={S.code}>/benchmark?tab=mcp</code>).
          </p>
        </Section>

        {/* ── Live slice catalog ─────────────────────────────────────────────── */}
        <Section title={`Каталог слайсов${slices ? ` · ${slices.length}` : ''}`}>
          <p style={S.note}>
            То, что отдаёт <code style={S.codeAcc}>lore_list_slices</code> — живой
            whitelist параметризованных запросов. Каждый слайс зовётся через{' '}
            <code style={S.codeAcc}>lore_query_slice</code>.
          </p>
          {health === 'down' && (
            <div style={S.down}>
              backend <code style={S.code}>:9100</code> не отвечает — каталог
              недоступен. Поднять backend (см. «Эксплуатация» ниже).
            </div>
          )}
          {health === 'checking' && <div style={S.note}>Загрузка каталога…</div>}
          {slices && slices.length > 0 && (
            <>
              <input
                style={S.filter}
                placeholder="фильтр по имени слайса…"
                aria-label="фильтр слайсов"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
              <div style={S.chips}>
                {shownSlices.map(s => (
                  <span key={s.id} style={S.chip} title={paramHint(s)}>
                    <code style={S.codeAcc}>{s.id}</code>
                    {s.required.length > 0 && (
                      <span style={S.req}>({s.required.join(', ')})</span>
                    )}
                    {s.optional.length > 0 && (
                      <span style={S.opt}>[{s.optional.join(', ')}]</span>
                    )}
                  </span>
                ))}
                {shownSlices.length === 0 && <span style={S.note}>Ничего не найдено.</span>}
              </div>
            </>
          )}
        </Section>

        {/* ── Config ─────────────────────────────────────────────────────────── */}
        <Section title="Конфиг (env)">
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr><Th>Переменная</Th><Th>Дефолт</Th><Th>Назначение</Th></tr></thead>
              <tbody>
                {ENV_ROWS.map(([k, v, d]) => (
                  <tr key={k} style={S.tr}>
                    <Td><code style={S.codeAcc}>{k}</code></Td>
                    <Td><code style={S.code}>{v}</code></Td>
                    <Td style={{ color: 'var(--t2)' }}>{d}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={S.note}>Регистрация у клиента (Claude Code) — <code style={S.code}>.mcp.json</code> в корне репо:</p>
          <Pre>{MCP_JSON}</Pre>
        </Section>

        {/* ── Ops ────────────────────────────────────────────────────────────── */}
        <Section title="Эксплуатация — поднять / поднять если упал">
          <ol style={S.ol}>
            <li>Проверить backend (частая причина «MCP не отвечает»):
              <Pre>curl http://localhost:9100/lore/slices   # ждём 200 + JSON-каталог</Pre>
            </li>
            <li>Если backend лежит — поднять его (Docker — рекомендуется):
              <Pre>{`cd C:/AIDA/UnlimitedLORE
$env:ARCADEDB_ROOT_PASSWORD='...'
docker compose up -d lore-backend     # backend на :9100`}</Pre>
            </li>
            <li>Собрать MCP-сервер (если не собран):
              <Pre>{`cd C:/AIDA/UnlimitedLORE/mcp-server
npm install && npm run build          # → dist/index.js`}</Pre>
            </li>
            <li>Клиент сам запускает процесс по stdio — отдельно «держать живым» не
              нужно. После правок <code style={S.code}>.mcp.json</code> или пересборки —
              перезапустить клиент.</li>
          </ol>
          <p style={S.note}>Смоук-тест без клиента (прямой stdio JSON-RPC):</p>
          <Pre>{SMOKE}</Pre>
        </Section>

        {/* ── Diagnostics ────────────────────────────────────────────────────── */}
        <Section title="Диагностика">
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr><Th>Симптом</Th><Th>Причина</Th><Th>Что делать</Th></tr></thead>
              <tbody>
                {([
                  ['Инструменты есть, любой вызов = ошибка', 'backend :9100 не поднят', 'поднять backend'],
                  ['403 на write', 'нет/неверный X-Seer-Role', 'env LORE_SEER_ROLE=admin'],
                  ['MART_UPSTREAM / 500', 'ArcadeDB недоступен или неверный пароль', 'проверить :2480 и ARCADEDB_ROOT_PASSWORD'],
                  ['Сервер не стартует под клиентом', 'не собран dist/', 'npm run build в mcp-server'],
                ] as [string, string, string][]).map(([a, b, c]) => (
                  <tr key={a} style={S.tr}>
                    <Td style={{ color: 'var(--t1)' }}>{a}</Td>
                    <Td style={{ color: 'var(--t2)' }}>{b}</Td>
                    <Td style={{ color: 'var(--t2)' }}>{c}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <p style={S.foot}>
          Полный runbook: <code style={S.code}>C:/AIDA/docs/change/sprints/MCP_AIDA_LORE_SERVER.md</code>
          {' · '}код: <code style={S.code}>C:/AIDA/UnlimitedLORE/mcp-server/</code>
        </p>
      </div>
    </div>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────
function paramHint(s: LoreSliceDescriptor): string {
  const r = s.required.length ? `обяз: ${s.required.join(', ')}` : '';
  const o = s.optional.length ? `опц: ${s.optional.join(', ')}` : '';
  return [r, o].filter(Boolean).join(' · ') || 'без параметров';
}

function HealthPill({ health, count }: { health: 'checking' | 'up' | 'down'; count?: number }) {
  const map = {
    checking: { c: 'var(--t3)', t: 'проверка…' },
    up:       { c: 'var(--suc)', t: `backend :9100 жив${count != null ? ` · ${count} слайсов` : ''}` },
    down:     { c: 'var(--dng)', t: 'backend :9100 не отвечает' },
  }[health];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 11, padding: '3px 10px', borderRadius: 20,
      background: `color-mix(in srgb, ${map.c} 14%, transparent)`,
      color: map.c, border: `1px solid color-mix(in srgb, ${map.c} 35%, transparent)`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: map.c }} />
      {map.t}
    </span>
  );
}

function KindTag({ kind }: { kind: 'read' | 'write' }) {
  const c = kind === 'write' ? 'var(--wrn)' : 'var(--inf)';
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
      background: `color-mix(in srgb, ${c} 16%, transparent)`,
      color: c, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
    }}>{kind}</span>
  );
}

function Node({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span style={{
      padding: '4px 10px', borderRadius: 5, fontSize: 11, whiteSpace: 'nowrap',
      fontFamily: 'var(--mono)',
      background: accent ? 'color-mix(in srgb, var(--acc) 16%, transparent)' : 'var(--b2)',
      color: accent ? 'var(--acc)' : 'var(--t2)',
      border: `1px solid ${accent ? 'color-mix(in srgb, var(--acc) 35%, transparent)' : 'var(--b3)'}`,
    }}>{children}</span>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', color: 'var(--t3)' }}>
      <span style={{ fontSize: 8, lineHeight: 1 }}>{label}</span>
      <span style={{ fontSize: 13, lineHeight: 1 }}>→</span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={S.h2}>{title}</h2>
      {children}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={S.th}>{children}</th>;
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ ...S.td, ...style }}>{children}</td>;
}
function Pre({ children }: { children: React.ReactNode }) {
  return <pre style={S.pre}>{children}</pre>;
}

// ── Styles ────────────────────────────────────────────────────────────────────
function entityChipStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '3px 9px', borderRadius: 20, fontSize: 11, cursor: 'pointer', userSelect: 'none',
    fontFamily: 'var(--mono)',
    background: active ? 'color-mix(in srgb, var(--acc) 16%, transparent)' : 'var(--b1)',
    color: active ? 'var(--acc)' : 'var(--t2)',
    border: `1px solid ${active ? 'color-mix(in srgb, var(--acc) 35%, transparent)' : 'var(--bd)'}`,
  };
}
function kindChipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '3px 9px', borderRadius: 20, fontSize: 11, cursor: 'pointer', userSelect: 'none',
    background: active ? 'var(--b3)' : 'transparent',
    color: active ? 'var(--t1)' : 'var(--t3)',
    border: `1px solid ${active ? 'var(--bdh)' : 'transparent'}`,
  };
}

const S: Record<string, React.CSSProperties> = {
  scroll:  { flex: 1, overflowY: 'auto', fontFamily: 'var(--font)' },
  wrap:    { maxWidth: 920, margin: '0 auto', padding: '22px 26px 60px' },
  head:    { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  h1:      { fontSize: 22, fontWeight: 700, fontFamily: 'var(--display)', color: 'var(--t1)' },
  h2:      { fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginBottom: 10,
             paddingBottom: 5, borderBottom: '1px solid var(--bd)' },
  lead:    { marginTop: 12, fontSize: 13, lineHeight: 1.65, color: 'var(--t2)' },
  pipe:    { marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 6 },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th:      { textAlign: 'left', padding: '7px 10px', color: 'var(--t3)', fontWeight: 600,
             fontSize: 11, borderBottom: '1px solid var(--bd)', background: 'var(--b1)',
             whiteSpace: 'nowrap' },
  tr:      { borderBottom: '1px solid var(--bd)' },
  td:      { padding: '7px 10px', verticalAlign: 'top', color: 'var(--t1)' },
  note:    { marginTop: 10, fontSize: 12, lineHeight: 1.6, color: 'var(--t3)' },
  code:    { fontFamily: 'var(--mono)', fontSize: 11, padding: '1px 5px', borderRadius: 3,
             background: 'var(--b2)', color: 'var(--t2)' },
  codeAcc: { fontFamily: 'var(--mono)', fontSize: 11, padding: '1px 5px', borderRadius: 3,
             background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)' },
  pre:     { marginTop: 8, padding: '10px 12px', borderRadius: 6, overflowX: 'auto',
             background: 'var(--b1)', border: '1px solid var(--bd)',
             fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.6, color: 'var(--t2)',
             whiteSpace: 'pre' },
  ol:      { marginTop: 4, paddingLeft: 20, fontSize: 12.5, lineHeight: 1.7, color: 'var(--t2)',
             display: 'flex', flexDirection: 'column', gap: 6 },
  filter:  { marginTop: 10, width: '100%', maxWidth: 320, height: 28, padding: '0 10px',
             background: 'var(--b1)', border: '1px solid var(--b3)', borderRadius: 5,
             color: 'var(--t1)', fontSize: 12, fontFamily: 'inherit', outline: 'none' },
  chips:   { marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip:    { display: 'inline-flex', alignItems: 'center', gap: 4,
             padding: '3px 4px', borderRadius: 4, background: 'var(--b1)',
             border: '1px solid var(--bd)' },
  req:     { fontSize: 10, color: 'var(--wrn)' },
  opt:     { fontSize: 10, color: 'var(--t3)' },
  down:    { marginTop: 10, padding: '10px 12px', borderRadius: 6, fontSize: 12,
             background: 'color-mix(in srgb, var(--dng) 10%, transparent)',
             border: '1px solid color-mix(in srgb, var(--dng) 30%, transparent)',
             color: 'var(--t2)' },
  foot:    { marginTop: 30, fontSize: 11, color: 'var(--t3)', lineHeight: 1.7,
             paddingTop: 12, borderTop: '1px solid var(--bd)' },

  // Entity/kind filter chips above the tools table.
  entityChips: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10 },
  entityChipCount: { fontSize: 9, opacity: 0.7 },
  kindToggle: { display: 'inline-flex', gap: 4, marginLeft: 8, paddingLeft: 8, borderLeft: '1px solid var(--bd)' },

  // Group header row within the tools table.
  trGroup: { background: 'var(--b1)' },
  tdGroup: { padding: '5px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const,
             letterSpacing: '0.06em', color: 'var(--acc)' },

  // Params column: one param per line instead of one squashed string.
  paramList: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  paramReq:  { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t1)' },
  paramOpt:  { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)' },
};
