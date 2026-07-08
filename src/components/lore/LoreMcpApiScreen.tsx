// LoreMcpApiScreen — published API reference for the `aida-lore` MCP server.
// Lives at /lore?section=mcp. Documents the LORE write/read tools, the backend
// contract, env and runbook, and pings the live backend to show health + the
// real slice catalog that `lore_list_slices` exposes. bench_* (MUNINN) tools
// live on the same server but are documented on /benchmark?tab=mcp instead.
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    params: 'sprint_id, name, status?, plan_id?, priority?, outcome_md?, context_md?',
    desc: 'KnowSprint: создать напрямую. Идемпотентен — upsert по sprint_id. Сеет начальную открытую KnowSprintHist-строку (HAS_STATE).' },
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
    desc: 'Ребро TARGETS_MILESTONE (спринт → веха) — единственный способ привязки. action = add | remove.' },

  // ── Status (SCD2-переходы, общие для нескольких типов) ────────────────────
  { name: 'lore_set_status', kind: 'write', entity: 'Status', backend: 'POST /lore/status',
    params: 'entity_type, id, status',
    desc: 'Сменить статус одной сущности через полный SCD2-переход: закрыть текущую открытую hist-строку (valid_to=now), открыть новую. entity_type = sprint | task | checkpoint | phase. status ∈ todo|planned|active|partial|done|blocked|high|cancelled|backlog|design|ready_for_deploy — status="cancelled" это и есть штатный soft-delete для этих типов, отдельного hard-delete тула для них нет и не планируется.' },
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
    desc: 'KnowMilestone: тот же эндпоинт, что и lore_create_milestone, для точечной правки существующей вехи — например, только goal_md, не трогая label/week. Спринты к вехе привязываются отдельно — lore_link_sprint_milestone (прямое ребро TARGETS_MILESTONE).' },

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

  // ── BRAGI content archive (SPEC-BRAGI-ARCHIVE-001 v0.4) ────────────────────
  { name: 'lore_upsert_rubric', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/rubric',
    params: 'rubric_id, name?, description?, order_index?',
    desc: 'BragiRubric: создать/дополнить рубрику — фиксированный список классификатора, назначаемого публикациям и ключам через rubric_id (upsert по rubric_id). Единый редакторский список, не свободные теги — сверяться со срезом bragi_rubrics перед созданием новой, чтобы не плодить дубли.' },
  { name: 'lore_link_rubric', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/rubric/link',
    params: 'entity_type ("publication"|"keyword"), entity_id, rubric_id',
    desc: 'Лёгкое присвоение/замена ОДНОЙ рубрики публикации или ключу через IN_RUBRIC — без пересылки остальных полей (в отличие от rubric_id на полном upsert). Заменяет прежнюю рубрику, не аддитивно.' },
  { name: 'lore_find_keyword', kind: 'read', entity: 'BRAGI', backend: 'GET /lore/bragi/keyword/search',
    params: 'q',
    desc: 'Поиск BragiKeyword по подстроке phrase (без учёта регистра), до 20 совпадений (keyword_id/phrase/cluster). Использовать перед lore_upsert_keyword/lore_link_rubric/keyword_ids на публикации — все требуют уже известный id.' },
  { name: 'lore_create_publication', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/publication',
    params: 'publication_id, title?, topic?, main_text_md?, type?, status_general?, keyword_ids?[], rubric_id?',
    desc: 'BragiPublication: создать/дополнить публикацию (upsert по publication_id, только переданные поля). Мастер-версия, группирующая вариации по площадкам (lore_create_variant). keyword_ids — рёбра TARGETS_KEY на существующие BragiKeyword (аддитивно, не отвязывает пропущенные при повторном вызове). rubric_id — ОДНА рубрика через IN_RUBRIC, заменяет прежнюю (не аддитивно).' },
  { name: 'lore_create_variant', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/variant',
    params: 'variant_id, publication_id?, channel_id?, text_md?, status?, url?, published_at?, asset_id?',
    desc: 'BragiVariant: создать/дополнить версию публикации под конкретную площадку (upsert по variant_id). publication_id → ребро HAS_VARIANT, channel_id → IN_CHANNEL (на существующий BragiChannel), asset_id → HAS_ASSET (на существующий BragiAsset) — рёбра создаются только если id передан.' },
  { name: 'lore_upload_asset', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/asset/upload',
    params: 'filename, base64_data, content_type?',
    desc: 'Загружает base64-файл в S3-хранилище (MinIO) BRAGI, возвращает same-origin file_url ("/lore/bragi/asset/file/..."). Единственный способ получить рабочий file_url — вызывать ПЕРВЫМ, затем передавать результат в lore_attach_asset.' },
  { name: 'lore_attach_asset', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/asset',
    params: 'asset_id, asset_type?, file_url?, alt?, size_bytes?, attach_to_publication_id?, attach_to_variant_id?',
    desc: 'BragiAsset: создать/дополнить изображение/медиа (upsert по asset_id) и опционально привязать через HAS_ASSET к существующей BragiPublication (обложка) или BragiVariant (картинка вариации) — передавать ровно одно из attach_to_*. file_url — из lore_upload_asset, если файла ещё нет в хранилище.' },
  { name: 'lore_upsert_keyword', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/keyword',
    params: 'keyword_id, phrase?, cluster?, freq_exact?, freq_broad?, source?, intent?, region_engine?, measured_at?, page_id?, rubric_id?',
    desc: 'BragiKeyword: создать/дополнить ключевую фразу (upsert по keyword_id). page_id → ребро TARGETS_PAGE на существующую BragiPage. rubric_id — ОДНА рубрика через IN_RUBRIC, заменяет прежнюю (не аддитивно).' },
  { name: 'lore_upsert_page', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/page',
    params: 'page_id, url?, title?, description?, page_type?, deployed_at?',
    desc: 'BragiPage: создать/дополнить целевую страницу (upsert по page_id).' },
  { name: 'lore_create_campaign', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/campaign',
    params: 'campaign_id, utm_source?, utm_medium?, utm_campaign?, target_url?, period?, variant_id?',
    desc: 'BragiCampaign: создать/дополнить UTM-кампанию (upsert по campaign_id). variant_id → ребро FOR_VARIANT на существующую BragiVariant.' },
  { name: 'lore_record_metric', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/metric',
    params: 'object_type, object_id, metric, value, ts?, source?, segment?',
    desc: 'MetricSnapshot: добавить одно измерение в TIMESERIES-хранилище BRAGI (нативный ArcadeDB time-series, не граф-вершина — без рёбер, привязка через теги object_type+object_id). ts принимает ISO-8601 или epoch millis, по умолчанию now(). Только запись — удаления/правки нет (immutable sealed-store).' },
  { name: 'lore_query_metric', kind: 'read', entity: 'BRAGI', backend: 'GET /lore/bragi/metric/query',
    params: 'object_type?, object_id?, metric?, from?, to?, agg?, limit?',
    desc: 'Чтение точек MetricSnapshot с фильтрами и опциональной агрегацией (agg: avg|sum|min|max|count, группировка по object_type+object_id+metric). Без agg — до limit сырых точек, новые сверху. object_type="probe" (артефакт проверки схемы ARC-02/03) всегда исключён.' },
  { name: 'lore_create_integration', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/integration',
    params: 'integration_id, service?, purpose?, endpoint?, scope?, secret_ref?, status?, last_called_at?',
    desc: 'BragiIntegration: создать/дополнить коннектор (upsert по integration_id). ⚠️ secret_ref обязан быть ссылкой ("env:X" / "vault:X" / "oauth:X" / "secret:X") — бэкенд отклоняет любое другое значение (400), значение токена в граф не попадает никогда.' },
  { name: 'lore_create_insight', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/insight',
    params: 'insight_id, statement_md?, insight_date?, evidence_ref?',
    desc: 'BragiInsight: создать/дополнить вывод из данных (upsert по insight_id). evidence_ref — свободный текст-указатель на замеры (у MetricSnapshot нет графовых рёбер). Для связи с задачей/ADR — lore_link_insight.' },
  { name: 'lore_link_insight', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/insight/link',
    params: 'insight_id, target_type, target_id',
    desc: 'Ребро LED_TO от существующего BragiInsight к KnowTask или KnowADR (target_type = task | adr, target_id = task_uid | adr_id) — зафиксировать, что инсайт привёл к конкретному действию. Идемпотентно.' },
  { name: 'lore_sync_integration', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/integration/sync',
    params: 'integration_id, metrics[]',
    desc: 'Каркас ручной синхронизации (без крона): пишет уже полученные извне метрики в MetricSnapshot и обновляет last_called_at интеграции. Сам к внешнему API НЕ обращается — маппинг источник→метрика и реальный HTTP-вызов (Яндекс.Метрика/Keys.so/GSC/Telegram) остаются на вызывающей стороне (реальный коннектор или человек, вставляющий цифры вручную). 404, если integration_id не существует. Живой опрос по расписанию отложен до появления реальных ключей (SPRINT_BRAGI_ARCHIVE_IMPL/INT-01,02).' },
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
  const { t } = useTranslation();
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
          <h1 style={S.h1}>{t('lore.mcpApi.headerTitle', 'MCP-сервер')} <span style={{ color: 'var(--acc)' }}>aida-lore</span></h1>
          <HealthPill health={health} count={slices?.length} />
        </div>
        <p style={S.lead}>
          {t('lore.mcpApi.lead', 'Прямой доступ ИИ-агента (Claude Desktop / Claude Code / Cursor) к движку LORE по протоколу MCP: читать план / спринты / ADR / решения / релизы и писать статусы и задачи — без ручного SQL. Сервер — тонкая обёртка над backend :9100; вся композиция SQL-слайсов и whitelisting остаётся на сервере.')}
        </p>

        {/* ── Pipeline ───────────────────────────────────────────────────────── */}
        <div style={S.pipe}>
          <Node>Claude</Node><Arrow label="stdio" />
          <Node accent>aida-lore-mcp</Node><Arrow label="HTTP" />
          <Node>backend :9100</Node><Arrow label="REST" />
          <Node>ArcadeDB :2480</Node>
        </div>

        {/* ── Tools ──────────────────────────────────────────────────────────── */}
        <Section title={
          shownTools.length !== TOOLS.length
            ? t('lore.mcpApi.toolsTitleFiltered', 'Инструменты ({{shown}} из {{total}})', { shown: shownTools.length, total: TOOLS.length })
            : t('lore.mcpApi.toolsTitle', 'Инструменты ({{count}})', { count: shownTools.length })
        }>
          <div style={S.entityChips}>
            <span
              style={entityChipStyle(entityFilter === null)}
              onClick={() => setEntityFilter(null)}
            >{t('lore.mcpApi.entityAll', 'Все')}</span>
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
                  {k === 'all' ? t('lore.mcpApi.kindReadWrite', 'read+write') : k}
                </span>
              ))}
            </span>
          </div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <Th>{t('lore.mcpApi.colTool', 'Инструмент')}</Th><Th>{t('lore.mcpApi.colType', 'Тип')}</Th><Th>{t('lore.mcpApi.colBackendCall', 'Backend-вызов')}</Th><Th>{t('lore.mcpApi.colParams', 'Параметры')}</Th><Th>{t('lore.mcpApi.colPurpose', 'Назначение')}</Th>
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
                  <tr><td colSpan={5} style={{ ...S.td, color: 'var(--t3)', textAlign: 'center' }}>{t('lore.mcpApi.toolsEmpty', 'Ничего не найдено под текущим фильтром.')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p style={S.note}>
            {t('lore.mcpApi.toolsNote1', 'Write-инструменты идут с заголовком')} <code style={S.code}>X-Seer-Role: admin</code>,
            {t('lore.mcpApi.toolsNote2', 'версионны (SCD2 — история не теряется) и мутируют общую')}{' '}
            <code style={S.code}>system_aida_lore</code> {t('lore.mcpApi.toolsNote3', '— применять осознанно.')}
            <code style={S.code}>lore_create_adr</code> {t('lore.mcpApi.toolsNote4', 'создаёт полную SCD2-структуру: вершина + KnowADRHist (valid_to=null) + HAS_STATE edge — тело ADR читается именно из hist-строки.')}{' '}
            {t('lore.mcpApi.toolsNote5', 'Партиальные (amend) вызовы у всех upsert-инструментов с 2026-07 безопасны — SQL SET собирается динамически, непереданное поле не трогается (раньше пропущенный параметр молча обнулялся).')}{' '}
            <b>{t('lore.mcpApi.toolsNoteDeletionLabel', 'Удаление:')}</b> {t('lore.mcpApi.toolsNote6', 'штатный путь — soft-delete через статус (')}<code style={S.code}>lore_set_status</code>
            {t('lore.mcpApi.toolsNote7', ' со status="cancelled"/"deprecated"/"archived" — история сохраняется). Настоящий hard-delete есть только у ')}<code style={S.code}>lore_delete_adr</code> {t('lore.mcpApi.toolsNote8', 'и')}{' '}
            <code style={S.code}>lore_delete_spec</code>, {t('lore.mcpApi.toolsNote9', 'оба явно помечены как «только для тестовых артефактов». Остальные типы (Sprint/Task/Release/Component/Milestone/ QualityGate/Runbook/Doc) осознанно без hard-delete тула — реальные данные не удаляются, только архивируются статусом.')}{' '}
            {t('lore.mcpApi.toolsNote10', 'Из набора пока не реализован только ')}<code style={S.code}>checkpoint</code> {t('lore.mcpApi.toolsNote11', '(бэкенд → 501). Инструменты по ')}<b>{t('lore.mcpApi.researchLabel', 'Исследованиям')}</b> {t('lore.mcpApi.toolsNote12', '(витрина RAGVSDL) — на отдельной странице «MCP API» в разделе «Исследования» (')}<code style={S.code}>/benchmark?tab=mcp</code>{t('lore.mcpApi.toolsNote13', ').')}
          </p>
        </Section>

        {/* ── Live slice catalog ─────────────────────────────────────────────── */}
        <Section title={slices ? t('lore.mcpApi.sliceCatalogTitleCount', 'Каталог слайсов · {{count}}', { count: slices.length }) : t('lore.mcpApi.sliceCatalogTitle', 'Каталог слайсов')}>
          <p style={S.note}>
            {t('lore.mcpApi.sliceCatalogNote1', 'То, что отдаёт')} <code style={S.codeAcc}>lore_list_slices</code> {t('lore.mcpApi.sliceCatalogNote2', '— живой whitelist параметризованных запросов. Каждый слайс зовётся через')}{' '}
            <code style={S.codeAcc}>lore_query_slice</code>.
          </p>
          {health === 'down' && (
            <div style={S.down}>
              {t('lore.mcpApi.backendDown', 'backend')} <code style={S.code}>:9100</code> {t('lore.mcpApi.backendDownRest', 'не отвечает — каталог недоступен. Поднять backend (см. «Эксплуатация» ниже).')}
            </div>
          )}
          {health === 'checking' && <div style={S.note}>{t('lore.mcpApi.catalogLoading', 'Загрузка каталога…')}</div>}
          {slices && slices.length > 0 && (
            <>
              <input
                style={S.filter}
                placeholder={t('lore.mcpApi.sliceFilterPlaceholder', 'фильтр по имени слайса…')}
                aria-label={t('lore.mcpApi.sliceFilterAriaLabel', 'фильтр слайсов')}
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
              <div style={S.chips}>
                {shownSlices.map(s => (
                  <span key={s.id} style={S.chip} title={paramHint(s, t)}>
                    <code style={S.codeAcc}>{s.id}</code>
                    {s.required.length > 0 && (
                      <span style={S.req}>({s.required.join(', ')})</span>
                    )}
                    {s.optional.length > 0 && (
                      <span style={S.opt}>[{s.optional.join(', ')}]</span>
                    )}
                  </span>
                ))}
                {shownSlices.length === 0 && <span style={S.note}>{t('lore.mcpApi.slicesEmpty', 'Ничего не найдено.')}</span>}
              </div>
            </>
          )}
        </Section>

        {/* ── Config ─────────────────────────────────────────────────────────── */}
        <Section title={t('lore.mcpApi.configTitle', 'Конфиг (env)')}>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr><Th>{t('lore.mcpApi.colVariable', 'Переменная')}</Th><Th>{t('lore.mcpApi.colDefault', 'Дефолт')}</Th><Th>{t('lore.mcpApi.colPurpose', 'Назначение')}</Th></tr></thead>
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
          <p style={S.note}>{t('lore.mcpApi.clientRegNote', 'Регистрация у клиента (Claude Code) —')} <code style={S.code}>.mcp.json</code> {t('lore.mcpApi.clientRegNoteRest', 'в корне репо:')}</p>
          <Pre>{MCP_JSON}</Pre>
        </Section>

        {/* ── Ops ────────────────────────────────────────────────────────────── */}
        <Section title={t('lore.mcpApi.opsTitle', 'Эксплуатация — поднять / поднять если упал')}>
          <ol style={S.ol}>
            <li>{t('lore.mcpApi.opsStep1', 'Проверить backend (частая причина «MCP не отвечает»):')}
              <Pre>curl http://localhost:9100/lore/slices   # ждём 200 + JSON-каталог</Pre>
            </li>
            <li>{t('lore.mcpApi.opsStep2', 'Если backend лежит — поднять его (Docker — рекомендуется):')}
              <Pre>{`cd C:/AIDA/UnlimitedLORE
$env:ARCADEDB_ROOT_PASSWORD='...'
docker compose up -d lore-backend     # backend на :9100`}</Pre>
            </li>
            <li>{t('lore.mcpApi.opsStep3', 'Собрать MCP-сервер (если не собран):')}
              <Pre>{`cd C:/AIDA/UnlimitedLORE/mcp-server
npm install && npm run build          # → dist/index.js`}</Pre>
            </li>
            <li>{t('lore.mcpApi.opsStep4', 'Клиент сам запускает процесс по stdio — отдельно «держать живым» не нужно. После правок')} <code style={S.code}>.mcp.json</code> {t('lore.mcpApi.opsStep4Rest', 'или пересборки — перезапустить клиент.')}</li>
          </ol>
          <p style={S.note}>{t('lore.mcpApi.smokeTestNote', 'Смоук-тест без клиента (прямой stdio JSON-RPC):')}</p>
          <Pre>{SMOKE}</Pre>
        </Section>

        {/* ── Diagnostics ────────────────────────────────────────────────────── */}
        <Section title={t('lore.mcpApi.diagnosticsTitle', 'Диагностика')}>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr><Th>{t('lore.mcpApi.colSymptom', 'Симптом')}</Th><Th>{t('lore.mcpApi.colCause', 'Причина')}</Th><Th>{t('lore.mcpApi.colFix', 'Что делать')}</Th></tr></thead>
              <tbody>
                {([
                  [t('lore.mcpApi.diag1a', 'Инструменты есть, любой вызов = ошибка'), t('lore.mcpApi.diag1b', 'backend :9100 не поднят'), t('lore.mcpApi.diag1c', 'поднять backend')],
                  [t('lore.mcpApi.diag2a', '403 на write'), t('lore.mcpApi.diag2b', 'нет/неверный X-Seer-Role'), t('lore.mcpApi.diag2c', 'env LORE_SEER_ROLE=admin')],
                  [t('lore.mcpApi.diag3a', 'MART_UPSTREAM / 500'), t('lore.mcpApi.diag3b', 'ArcadeDB недоступен или неверный пароль'), t('lore.mcpApi.diag3c', 'проверить :2480 и ARCADEDB_ROOT_PASSWORD')],
                  [t('lore.mcpApi.diag4a', 'Сервер не стартует под клиентом'), t('lore.mcpApi.diag4b', 'не собран dist/'), t('lore.mcpApi.diag4c', 'npm run build в mcp-server')],
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
          {t('lore.mcpApi.footRunbook', 'Полный runbook:')} <code style={S.code}>C:/AIDA/docs/change/sprints/MCP_AIDA_LORE_SERVER.md</code>
          {' · '}{t('lore.mcpApi.footCode', 'код:')} <code style={S.code}>C:/AIDA/UnlimitedLORE/mcp-server/</code>
        </p>
      </div>
    </div>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────
function paramHint(s: LoreSliceDescriptor, t: (key: string, fallback: string, opts?: Record<string, unknown>) => string): string {
  const r = s.required.length ? t('lore.mcpApi.hintRequired', 'обяз: {{list}}', { list: s.required.join(', ') }) : '';
  const o = s.optional.length ? t('lore.mcpApi.hintOptional', 'опц: {{list}}', { list: s.optional.join(', ') }) : '';
  return [r, o].filter(Boolean).join(' · ') || t('lore.mcpApi.hintNoParams', 'без параметров');
}

function HealthPill({ health, count }: { health: 'checking' | 'up' | 'down'; count?: number }) {
  const { t } = useTranslation();
  const map = {
    checking: { c: 'var(--t3)', t: t('lore.mcpApi.healthChecking', 'проверка…') },
    up:       { c: 'var(--suc)', t: count != null
      ? t('lore.mcpApi.healthUpWithCount', 'backend :9100 жив · {{count}} слайсов', { count })
      : t('lore.mcpApi.healthUp', 'backend :9100 жив') },
    down:     { c: 'var(--dng)', t: t('lore.mcpApi.healthDown', 'backend :9100 не отвечает') },
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
