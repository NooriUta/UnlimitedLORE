// LoreMcpApiScreen — published API reference for the `aida-lore` MCP server.
// Lives at /lore?section=mcp. Documents the LORE write/read tools, the backend
// contract, env and runbook, and pings the live backend to show health + the
// real slice catalog that `list_slices` exposes. bench_* (MUNINN) tools
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

// ADR-LORE-014 §2 rename (T02, 2026-07): every lore_* tool renamed to <category>_<verb>,
// ~22 lore_link_*/lore_unlink_* collapsed into 8 <category>_link(rel, ...) tools. Names/params
// below are sourced directly from mcp-server/src/tools/loreWrite.ts + loreRead.ts (ground truth),
// cross-checked against mcp-server/MIGRATION.md for the old→new mapping.
const TOOLS: ToolDoc[] = [
  // ── Read ──────────────────────────────────────────────────────────────────
  { name: 'list_slices', kind: 'read', entity: 'Meta', backend: 'GET /lore/slices', params: '—',
    desc: 'Каталог всех именованных слайсов (read-запросов) с их обязательными/опциональными параметрами. Вызывать первым — задаёт, что вообще можно прочитать через query_slice.' },
  { name: 'query_slice', kind: 'read', entity: 'Meta', backend: 'GET /lore/slice/{slice}', params: 'slice, params?',
    desc: 'Выполнить один слайс из каталога list_slices и получить rows[]. params — map строк-значений: {"id":"ADR-FE-001"}, {"sprint_id":"SPRINT_X"} и т.п. Сам SQL и whitelisting полей — на бэкенде, клиент их не видит.' },

  // ── Sprint (KnowSprint) ──────────────────────────────────────────────────
  { name: 'sprint_new', kind: 'write', entity: 'Sprint', backend: 'POST /lore/sprint/create',
    params: 'sprint_id, name, status?, plan_id?, priority?, outcome_md?, context_md?',
    desc: 'KnowSprint: создать напрямую. Идемпотентен — upsert по sprint_id. Сеет начальную открытую KnowSprintHist-строку (HAS_STATE).' },
  { name: 'sprint_set', kind: 'write', entity: 'Sprint', backend: 'POST /lore/sprint/update, POST /lore/sprint/refs',
    params: 'sprint_id, name?, outcome_md?, context_md?, plan_id?, effort_days?, pr_numbers?[], pr_git_project?, pr_repo_url?, pr_replace?',
    desc: 'KnowSprint: слитый инструмент (T02) — старые lore_update_sprint (метаданные) + lore_update_sprint_refs (pr_refs) в одном вызове, маршрутизация по тому, какие поля переданы (можно оба сразу — тогда два запроса к бэкенду последовательно). pr_numbers добавляются к pr_refs (уже присутствующие пропускаются); pr_replace=true — сначала отбросить старые pr_refs, а не дописывать. Статус этим тулом не меняется — status_set. Правило: всегда заполнять context_md, если известно, зачем спринт существует.' },
  { name: 'sprint_link', kind: 'write', entity: 'Sprint', backend: 'POST /lore/sprint/project, /lore/sprint/dep, /lore/sprint/component, /lore/milestone/sprint',
    params: 'sprint_id, rel (project|dep|component|milestone), target_id, kind?, reason?, action?',
    desc: 'Link-collapse (T02, 4→1): rel="project" — BELONGS_TO_PROJECT, target_id=git_project (спринт может относиться к нескольким репозиториям). rel="dep" — DEPENDS_ON на ДРУГОЙ спринт, target_id=спринт-от-которого-зависим; kind = hard (блокирует деплой) | soft (координация) | gate (go/no-go) | informs; сервер отклоняет циклы. rel="component" — явное ребро BELONGS_TO, target_id=component_id, перекрывает нечёткий матч по имени. rel="milestone" — TARGETS_MILESTONE, target_id=milestone_id, единственный способ привязки к вехе. action = add | remove, идемпотентно на add.' },

  // ── Status (SCD2-переходы, общие для нескольких типов) ────────────────────
  { name: 'status_set', kind: 'write', entity: 'Status', backend: 'POST /lore/status',
    params: 'entity_type, id, status',
    desc: 'Сменить статус одной сущности через полный SCD2-переход: закрыть текущую открытую hist-строку (valid_to=now), открыть новую. entity_type = sprint | task | checkpoint | phase. status ∈ todo|planned|active|partial|done|blocked|high|cancelled|backlog|design|ready_for_deploy — status="cancelled" это и есть штатный soft-delete для этих типов, отдельного hard-delete тула для них нет и не планируется.' },
  { name: 'status_set_batch', kind: 'write', entity: 'Status', backend: 'POST /lore/status/batch',
    params: 'entity_type, ids[], status',
    desc: 'То же самое (SCD2-переход), но сразу для списка id одного entity_type. Ошибки собираются по каждому элементу отдельно и не прерывают остальные. Возвращает {ok, updated, errors[]}.' },

  // ── Task (KnowTask) ────────────────────────────────────────────────────────
  { name: 'task_new', kind: 'write', entity: 'Task', backend: 'POST /lore/task',
    params: 'sprint_id, task_id, title, note_md?, phase_uid?, author_agent?, executor_agent?, reviewer_agent?, task_type?',
    desc: 'KnowTask: создать задачу в спринте (order_index = max по спринту + 1, стартовый статус PLANNED с открытой hist-строкой). phase_uid — опционально сразу привязать к фазе тем же вызовом (ребро IN_PHASE); фаза должна уже существовать (sprint_phase_new) и принадлежать тому же спринту. author/executor/reviewer_agent (ADR-LORE-014 §4) — свободный текст, но лучше значением из справочника agent_role (dictionary, dict_set) — кто поставил/кто исполняет/кто примет задачу. task_type (ADR-LORE-015, T14) — classification planning|design|dev|test|ops|research|analytics|docs|content, по умолчанию "dev".' },
  { name: 'task_set', kind: 'write', entity: 'Task', backend: 'POST /lore/task/edit, POST /lore/task/edit/batch',
    params: 'task_uid, title, note_md?, effort_days?, author_agent?, executor_agent?, reviewer_agent?, task_type? | tasks: [{task_uid, title, note_md?, effort_days?, author_agent?, executor_agent?, reviewer_agent?, task_type?}]',
    desc: 'KnowTask: изменить заголовок/заметку/оценку трудозатрат/роли/task_type существующей задачи (обновляется и вершина, и её открытая hist-строка). Одиночный режим — task_uid+title в аргументах напрямую; batch-режим — массив tasks[] за один вызов, ошибки собираются по элементу, не прерывая остальные. reviewer_agent должен отличаться от executor_agent — единственный жёсткий гейт SDLC: status_set task→done отклоняется (409 NO_SELF_ACCEPTANCE), если ревьювер и исполнитель совпадают.' },
  { name: 'task_mv', kind: 'write', entity: 'Task', backend: 'POST /lore/task/move',
    params: 'task_uid, target_sprint_id, new_task_id?',
    desc: 'Переместить задачу в другой спринт (ADR-LORE-013, cancel+recreate) — создаёт свежую копию в target_sprint_id (title/note_md/effort_days + TAGGED_WITH-компоненты, начальный статус PLANNED), исходную помечает ❌ CANCELLED-надгробием. НЕ переключение PK: у новой задачи СВОЯ история статусов, у исходной — своя. task_id переиспользуется, если свободен в цели, иначе new_task_id, иначе суффикс "<id>_N" (возвращается как new_task_id + task_id_changed). IN_PHASE и входящие рёбра (PROMOTED_TO/LED_TO) остаются на исходной — перепривязать на новую через task_link.' },
  { name: 'task_link', kind: 'write', entity: 'Task', backend: 'POST /lore/task/phase, POST /lore/task/component',
    params: 'task_uid, rel (phase|component), target_id?, action?',
    desc: 'Link-collapse (T02, 2→1): rel="phase" — ребро IN_PHASE к фазе спринта (задача и фаза обязаны принадлежать одному спринту; action="remove" без target_id отвязывает от ВСЕХ фаз). rel="component" — ребро TAGGED_WITH к LoreComponent, many-to-many. Идемпотентно на add.' },

  // ── Phase (KnowPhase) ──────────────────────────────────────────────────────
  { name: 'sprint_phase_new', kind: 'write', entity: 'Phase', backend: 'POST /lore/phase',
    params: 'sprint_id, phase_key, name?, order_index?',
    desc: 'KnowPhase: создать фазу спринта. phase_uid = "<sprint_id>/PHASE_<KEY>", ребро PART_OF → спринт, стартовый статус PLANNED в KnowPhaseHist. Идемпотентно — повторный вызов с тем же phase_key возвращает существующую фазу (created=false), ничего не меняя. Статус фазы (вкл. soft-delete) — через status_set с entity_type="phase".' },

  // ── Milestone (KnowMilestone) ────────────────────────────────────────────
  { name: 'milestone_new', kind: 'write', entity: 'Milestone', backend: 'POST /lore/milestone',
    params: 'milestone_id, label?, week?, date_display?, goal_md?, priority?',
    desc: 'KnowMilestone: создать веху (upsert по milestone_id). Партиальные вызовы безопасны — непереданные поля не обнуляются. goal_md пишется в открытую KnowMilestoneHist-строку (создаётся при первом заполнении), остальные поля — на вершину.' },
  { name: 'milestone_set', kind: 'write', entity: 'Milestone', backend: 'POST /lore/milestone',
    params: 'milestone_id, label?, week?, date_display?, goal_md?, priority?',
    desc: 'KnowMilestone: тот же эндпоинт, что и milestone_new, для точечной правки существующей вехи — например, только goal_md, не трогая label/week. Спринты к вехе привязываются отдельно — sprint_link(rel:"milestone").' },

  // ── ADR (KnowADR) ─────────────────────────────────────────────────────────
  { name: 'adr_new', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr',
    params: 'adr_id, name, status?, date_created?, component_id?, component_ids?, context_md?, decision_md?, consequences_md?, depends_on_ids?, supersedes_ids?, tags?, file_path?',
    desc: 'KnowADR: создать или дописать (upsert по adr_id). Полная SCD2-структура — вершина + открытая KnowADRHist + ребро HAS_STATE; тело (context_md/decision_md/consequences_md) читается именно из hist-строки. Частичные вызовы безопасны — непереданные поля не обнуляются. depends_on_ids/supersedes_ids/component_ids/tags при передаче ПОЛНОСТЬЮ заменяют набор рёбер этого типа, а не дополняют его.' },
  { name: 'adr_set', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr',
    params: 'adr_id, name, status?, date_created?, component_id?, component_ids?, context_md?, decision_md?, consequences_md?, depends_on_ids?, supersedes_ids?, tags?, file_path?',
    desc: 'KnowADR: тот же эндпоинт, что и adr_new, но сигнатура заточена под точечную правку существующего ADR — например, передать только decision_md, чтобы поправить один раздел, не трогая остальные. name всё ещё обязателен параметром (бэкенд перезаписывает его на каждый вызов).' },
  { name: 'adr_link', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr/link, /lore/adr/component, /lore/adr/depends_on, /lore/adr/supersedes, /lore/adr/tag',
    params: 'adr_id, rel (sprint|release|component|depends_on|supersedes|tag), target_id, git_project?, action?',
    desc: 'Link-collapse (T02, 6→1) — привязка ОДНОГО ребра за раз (полная замена набора через component_ids/depends_on_ids/supersedes_ids/tags на adr_new/adr_set — для другого случая, «пересоздать весь набор»). rel="sprint" — IMPLEMENTED_IN, target_id=sprint_id (заполняет implemented_in_ids в слайсе adr). rel="release" — IMPLEMENTED_IN_RELEASE, target_id=release_id, передавать git_project для multi-repo (release_uid = "{git_project}#{release_id}"). rel="component" — BELONGS_TO. rel="depends_on" — DEPENDS_ON на ADR, от которого зависим. rel="supersedes" — SUPERSEDES на СТАРЫЙ ADR (в паре со status="SUPERSEDED" на старом через отдельный adr_set). rel="tag" — TAGGED_WITH (апсертит KnowTag). Идемпотентно на add.' },
  { name: 'adr_rename', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr/rename',
    params: 'adr_id, new_adr_id',
    desc: 'KnowADR: переименовать по месту (меняется только adr_id на той же вершине). Все рёбра (DEPENDS_ON/SUPERSEDES/BELONGS_TO/TAGGED_WITH/IMPLEMENTED_IN*/HAS_STATE) висят на вершине по @rid и переживают переименование без перевешивания. Отказ, если new_adr_id уже занят. Упоминания старого id строкой в документах/.md — НЕ обновляются автоматически.' },
  { name: 'adr_del', kind: 'write', entity: 'ADR', backend: 'POST /lore/adr/delete',
    params: 'adr_id',
    desc: 'KnowADR: БЕЗВОЗВРАТНО удалить (hard delete) — каскад рёбра → KnowADRHist-строки → вершина. Единственное намеренное исключение из общего правила «soft-delete через статус»: для реального ADR вместо удаления всегда предпочесть status=DEPRECATED/SUPERSEDED через adr_set; hard-delete — только для тестовых артефактов и ошибочных созданий.' },

  // ── Decision (KnowDecision) ──────────────────────────────────────────────
  { name: 'decision_new', kind: 'write', entity: 'Decision', backend: 'POST /lore/decision',
    params: 'decision_id, title, body_md?, date_created?, refs_raw?',
    desc: 'KnowDecision: создать или обновить (upsert по decision_id, частичные вызовы безопасны). Для фиксации разовых ключевых решений, принятых в ходе спринта или дизайн-сессии — не заменяет ADR, а дополняет их для менее формальных вердиктов.' },

  // ── Spec (KnowSpec) ───────────────────────────────────────────────────────
  { name: 'spec_new', kind: 'write', entity: 'Spec', backend: 'POST /lore/spec',
    params: 'spec_id, title, version?, component_id?, content_md?, summary?, file_path?',
    desc: 'KnowSpec: создать или дописать (upsert по spec_id), с SCD2-историей. Body-поля (content_md/version/summary) пишутся в открытую KnowSpecHist-строку (создаётся, если её ещё нет) — именно её читает слайс spec_by_id, не вершину напрямую. Частичные вызовы безопасны — непереданные поля не обнуляются.' },
  { name: 'spec_set', kind: 'write', entity: 'Spec', backend: 'POST /lore/spec',
    params: 'spec_id, title, version?, component_id?, content_md?, summary?, file_path?',
    desc: 'KnowSpec: тот же эндпоинт, что и spec_new, сигнатура под точечный amend (зеркало adr_set) — например, только version, чтобы поднять версию спеки без пересылки всего тела. title обязателен на каждый вызов.' },
  { name: 'spec_del', kind: 'write', entity: 'Spec', backend: 'POST /lore/spec/delete',
    params: 'spec_id',
    desc: 'KnowSpec: безвозвратно удалить вершину по spec_id (hard delete — у KnowSpec нет статусного поля для soft-delete).' },

  // ── Tech registry (SPRINT_TECH_REGISTRY) ──────────────────────────────────
  { name: 'tech_set', kind: 'write', entity: 'Tech', backend: 'POST /lore/spec',
    params: 'component_id, tech_name, version, release_date?, our_release?, license?, usage?, source_url?, checked_at?',
    desc: 'Зарегистрировать/обновить одну технологию (версия + дата релиза + лицензия + источник + наш релиз + использование) для компонента — например «ArcadeDB 26.6.1» под YGG. Хранится как один KnowSpec на пару (компонент, технология) через существующий upsert-путь спек — spec_id "SPEC-TECH-<COMPONENT>-<TECH>". Идемпотентно — upsert по этому id. Читать обратно через query_slice(slice="tech_registry", params={component: "<ID>"}) (component опционален — без него полный реестр).' },

  // ── QualityGate ───────────────────────────────────────────────────────────
  { name: 'qg_new', kind: 'write', entity: 'QualityGate', backend: 'POST /lore/quality-gate',
    params: 'qg_id, name, description?, component_id?, status?, content_md?, sprint_id?',
    desc: 'QualityGate: создать или обновить (upsert по qg_id, частичные вызовы безопасны) — сам гейт как вершину, с текстом инвариантов в content_md. Soft-delete гейта — status="deprecated"/"archived". Прогоны и метрики к этой вершине пишет отдельно qg_run_log.' },

  // ── Runbook (KnowRunbook) ─────────────────────────────────────────────────
  { name: 'runbook_new', kind: 'write', entity: 'Runbook', backend: 'POST /lore/runbook',
    params: 'runbook_id, name, area?, date_created?, content_md?',
    desc: 'KnowRunbook: создать или обновить (upsert по runbook_id, частичные вызовы безопасны) — операционный плейбук/инструкция (area: recovery, infra, deploy, ops, auth, db, service…).' },
  { name: 'runbook_link', kind: 'write', entity: 'Runbook', backend: 'POST /lore/runbook/adr',
    params: 'runbook_id, rel ("adr", единственное значение сегодня), adr_id, action?',
    desc: 'Ребро REFERENCES_ADR (KnowRunbook → KnowADR) — рунбук, упоминающий ADR только текстовым [[ADR-ID]] wiki-линком внутри content_md, НЕ имеет настоящего графового ребра; этот тул его создаёт (питает поле adr_ids слайсов runbooks/runbook_by_id). rel оставлен как параметр для симметрии с другими *_link тулами, реального выбора значений пока нет. Идемпотентно на add.' },

  // ── Doc (KnowDoc) ─────────────────────────────────────────────────────────
  { name: 'doc_new', kind: 'write', entity: 'Doc', backend: 'POST /lore/doc',
    params: 'doc_id, title?, kind?, has_ext_deps?, component_id?, file_path?, content_md_en?, content_md_ru?, content_html?, parent_doc_id?, sort_order?',
    desc: 'KnowDoc: создать или обновить (upsert по doc_id, частичные вызовы безопасны — непереданные поля сохраняют текущее значение). content_md_en/content_md_ru (чистый Markdown, рендерится in-DOM с поддержкой mermaid) предпочтительнее content_html — легаси-поле для уже существующих HTML-фрагментов, до 100 КБ. parent_doc_id — родитель в DeepWiki-дереве страниц (в этом же вызове, заменяет текущего родителя; "" — открепить; для репарента без изменения контента лучше doc_link(rel:"parent")). sort_order — позиция среди дочерних страниц одного родителя.' },
  { name: 'doc_link', kind: 'write', entity: 'Doc', backend: 'POST /lore/doc/parent, /lore/doc/component, /lore/doc/sprint',
    params: 'doc_id, rel (parent|component|sprint), target_id?, action?',
    desc: 'Link-collapse (T02, 3→1): rel="parent" — DOC_CHILD_OF (дерево DeepWiki-страниц), у документа максимум один родитель, action="add" всегда сначала заменяет текущее ребро (перенос страницы — один вызов); action="remove" открепляет в корень (target_id не нужен). rel="component" — BELONGS_TO. rel="sprint" — IMPLEMENTED_IN. Идемпотентно на add.' },
  { name: 'doc_del', kind: 'write', entity: 'Doc', backend: 'POST /lore/doc/delete',
    params: 'doc_id',
    desc: 'KnowDoc: БЕЗВОЗВРАТНО удалить: каскад рёбра → KnowDocHist-строки → вершина. Необратимо — только для устаревших дублей и пустых страниц-заглушек (например легаси DOC-* записи, вытесненные новым guide_*/product_*/ref_* документом с реальным содержимым). Проверить, что content_html/content_md_en/content_md_ru действительно пусты (слайс doc_by_id), прежде чем удалять что-то, что может нести реальный контент.' },

  // ── QG-рутина: прогон → job-task → рекомендация → задача ──────────────────
  { name: 'qg_run_log', kind: 'write', entity: 'QG-flow', backend: 'POST /lore/qg/run',
    params: 'routine_name, run_date, status, metrics[]?, started_at?, finished_at?, flags?, run_id?',
    desc: 'ClRoutineRun + ClRoutineMetric: записать результат завершённого прогона QG-рутины. Вызывать один раз в конце каждого прогона. metrics[] — SMART-метрики по ADR-QG-002: каждая несёт key/value/unit/target/status/source (source — команда-репродьюсер + file:line evidence, на неё опирается rec_new).' },
  { name: 'qg_job_new', kind: 'write', entity: 'QG-flow', backend: 'POST /lore/qg/job-task',
    params: 'job_id, qg_id, inv_id?, run_date?, severity?, status?, note_md?',
    desc: 'QGJobTask: upsert + ребро YIELDED от родительской QualityGate. Вызывать, когда конкретный инвариант провалился (FAIL). Если позже приходит PASS по тому же qg_id+inv_id — открытые job-task для этой пары автоматически закрываются как resolved.' },
  { name: 'rec_new', kind: 'write', entity: 'QG-flow', backend: 'POST /lore/qg/recommendation',
    params: 'rec_id, job_id, title, body_md?, status?, priority?, severity?, effort_days?, tags?, component_id?, qg_id?, inv_id?, fix_cmd?, how_to_verify?',
    desc: 'QGRecommendation: upsert + ребро PRODUCED от родительской QGJobTask — предложение, как исправить провалившийся инвариант. Статус стартует как pending и ждёт подтверждения пользователем (rec_promote). Пустая рекомендация бесполезна — стараться заполнять priority/severity/effort_days/fix_cmd/how_to_verify.' },
  { name: 'rec_promote', kind: 'write', entity: 'QG-flow', backend: 'POST /lore/qg/promote',
    params: 'rec_id, sprint_id?, task_uid?, title?, note_md?, task_type?',
    desc: 'QGRecommendation → KnowTask: подтвердить рекомендацию, создать задачу и ребро PROMOTED_TO, пометить рекомендацию как promoted. По умолчанию задача уходит в недельный ротирующийся спринт SPRINT_QG_HOUSEKEEPING_<ISO-неделя> (авто-создаётся при первом использовании за неделю, виден на доске «План»); явный sprint_id — override. note_md, если не передан, бэкенд сам собирает из полей рекомендации. task_type (T13) — override, по умолчанию "research" (ADR-LORE-015: аналитик владеет research). Вызывать только после явного «да» от пользователя.' },

  // ── Component (LoreComponent) ─────────────────────────────────────────────
  { name: 'component_new', kind: 'write', entity: 'Component', backend: 'POST /lore/component/create',
    params: 'component_id, full_name?, area?, team?, game_icon?, owner?, parent_id?',
    desc: 'LoreComponent: создать новый компонент (upsert по component_id). Для компонентов, которых в графе ещё нет — если компонент уже существует, использовать component_set, а не пересоздавать.' },
  { name: 'component_set', kind: 'write', entity: 'Component', backend: 'POST /lore/component/update',
    params: 'component_id, full_name?, area?, team?, game_icon?, owner?, parent_id?',
    desc: 'LoreComponent: частичное обновление существующего компонента — переименование, смена владельца/команды/иконки, репарент. Пишутся только переданные поля. Новый компонент этим тулом не создать.' },

  // ── Dictionary (KnowDictEntry, ADR-LORE-012) ──────────────────────────────
  { name: 'dict_set', kind: 'write', entity: 'Dictionary', backend: 'POST /lore/dict/entry',
    params: 'dict_type, code, label_ru?, label_en?, color?, icon?, sort_order?, is_active?, is_extensible?',
    desc: 'KnowDictEntry: создать/дописать одно значение справочника — upsert по (dict_type, code), партициально-безопасно (непереданные поля метаданных не трогаются; is_active по умолчанию true, is_extensible false при создании). Единый канон, читается фронтом (useDictionary), бэкендом и MCP через query_slice "dictionary". Примеры dict_type: sprint_status, task_status, adr_status, priority, area, agent_role, task_type, bragi_channel, tag. Проверить query_slice "dictionary" (опционально dict_type=...) перед добавлением, чтобы не плодить дубли.' },

  // ── Release (KnowRelease) ──────────────────────────────────────────────────
  { name: 'release_new', kind: 'write', entity: 'Release', backend: 'POST /lore/release',
    params: 'release_id, release_date?, git_tag?, type?, description_md?, is_current?, week?, git_project?',
    desc: 'KnowRelease: создать вершину релиза. is_current=true автоматически снимает флаг с предыдущего текущего релиза того же git_project. Сеет KnowReleaseHist + ребро HAS_STATE.' },
  { name: 'release_set', kind: 'write', entity: 'Release', backend: 'POST /lore/release/update',
    params: 'release_id, git_tag?, release_date?, description_md?, is_current?, git_project?',
    desc: 'KnowRelease: частичное обновление существующего релиза — пишутся только переданные поля. Удобно, чтобы дописать description_md/git_tag уже после того, как релиз вышел.' },
  { name: 'release_link', kind: 'write', entity: 'Release', backend: 'POST /lore/release/link',
    params: 'release_id, rel (sprint|pr), ids[], git_project',
    desc: 'Link-collapse (T02, 2→1): rel="sprint" — ребро IMPLEMENTED_IN_RELEASE (KnowSprint → KnowRelease) для одного или нескольких sprint_id. rel="pr" — апсертит вершины KnowPR и создаёт ребро SHIPPED_IN для одного или нескольких PR-номеров. MULTI-REPO: всегда передавать git_project — release_uid = "{git_project}#{release_id}". Для удаления привязок — release_unlink.' },
  { name: 'release_unlink', kind: 'write', entity: 'Release', backend: 'POST /lore/release/unlink',
    params: 'release_id, git_project, sprint_ids?, pr_numbers?',
    desc: 'Убрать рёбра IMPLEMENTED_IN_RELEASE (спринт→релиз) и/или SHIPPED_IN (PR→релиз) — для исправления случайных двойных привязок. Не собран в rel-форму как release_link — уже batch-формы (списки id) без переключателя action.' },
  { name: 'release_mv', kind: 'write', entity: 'Release', backend: 'POST /lore/project/move',
    params: 'entity_type (pr|release), id, git_project',
    desc: 'Исправить git_project у PR или релиза, ошибочно привязанного не к тому репозиторию: перевешивает ребро BELONGS_TO_PROJECT, обновляет pr_uid или release_uid. Renamed from lore_move_to_project (T02) — не входит в семью project_* несмотря на путь /lore/project/move: "project" там означает НОВЫЙ project_new/KnowGitProject тул, другую сущность (см. MIGRATION.md).' },

  // ── BRAGI content archive (SPEC-BRAGI-ARCHIVE-001 v0.4) ────────────────────
  // Sub-namespaced (bragi_pub_new, bragi_channel_set, …) per ADR-LORE-014 §2 rather than
  // flattened bragi_new/bragi_set — BRAGI covers 9+ distinct sub-entities.
  { name: 'bragi_rubric_set', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/rubric',
    params: 'rubric_id, name?, description?, order_index?',
    desc: 'BragiRubric: создать/дополнить рубрику — фиксированный список классификатора, назначаемого публикациям (bragi_pub_new) и ключам (bragi_keyword_set) через rubric_id (upsert по rubric_id). Единый редакторский список, не свободные теги — сверяться со срезом bragi_rubrics перед созданием новой, чтобы не плодить дубли.' },
  { name: 'bragi_channel_set', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/channel',
    params: 'channel_id, channel_type?, url_handle?, funnel_role?, rules_md?',
    desc: 'BragiChannel: создать/дополнить канал дистрибуции (например CH-TG, CH-SITE) — upsert по channel_id, частично-безопасно. rules_md — структурные лимиты/стилевые правила площадки в markdown (лимиты символов TG caption/post/poll, VC footer-link политика, правила код-блоков Habr и т.п.) — их читает валидатор перед публикацией. Проверить query_slice "bragi_channels" перед созданием нового канала.' },
  { name: 'bragi_search', kind: 'read', entity: 'BRAGI', backend: 'GET /lore/bragi/keyword/search',
    params: 'q',
    desc: 'Поиск BragiKeyword по подстроке phrase (без учёта регистра), до 20 совпадений (keyword_id/phrase/cluster). Использовать перед bragi_keyword_set/bragi_link(rel:"rubric")/keyword_ids на публикации — все требуют уже известный id.' },
  { name: 'bragi_pub_new', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/publication',
    params: 'publication_id, title?, topic?, main_text_md?, type?, status_general?, keyword_ids?[], rubric_id?, annotation_md?, todo_md?',
    desc: 'BragiPublication: создать/дополнить публикацию (upsert по publication_id, только переданные поля). Мастер-версия, группирующая вариации по площадкам (bragi_variant_new). keyword_ids — рёбра TARGETS_KEY на существующие BragiKeyword (аддитивно, не отвязывает пропущенные при повторном вызове). rubric_id — ОДНА рубрика через IN_RUBRIC, заменяет прежнюю (не аддитивно). annotation_md/todo_md — редакторские заметки, никогда не рендерятся в публичный скин площадки.' },
  { name: 'bragi_variant_new', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/variant',
    params: 'variant_id, publication_id?, channel_id?, text_md?, status?, url?, published_at?, asset_id?, annotation_md?, todo_md?',
    desc: 'BragiVariant: создать/дополнить версию публикации под конкретную площадку (upsert по variant_id). publication_id → ребро HAS_VARIANT, channel_id → IN_CHANNEL (на существующий BragiChannel), asset_id → HAS_ASSET (на существующий BragiAsset) — рёбра создаются только если id передан.' },
  { name: 'bragi_asset_up', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/asset/upload',
    params: 'filename, base64_data, content_type?',
    desc: 'Загружает base64-файл в S3-хранилище (MinIO) BRAGI, возвращает same-origin file_url ("/lore/bragi/asset/file/..."). Единственный способ получить рабочий file_url — вызывать ПЕРВЫМ, затем передавать результат в bragi_asset_attach. Renamed from lore_upload_asset (T02); ADR-LORE-014 §2 называет эту пару doc_asset_up/doc_asset_attach в категории "doc", но они физически работают с BragiAsset — переименовано под фактическую сущность (см. MIGRATION.md).' },
  { name: 'bragi_asset_attach', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/asset',
    params: 'asset_id, asset_type?, file_url?, alt?, size_bytes?, attach_to_publication_id?, attach_to_variant_id?',
    desc: 'BragiAsset: создать/дополнить изображение/медиа (upsert по asset_id) и опционально привязать через HAS_ASSET к существующей BragiPublication (обложка) или BragiVariant (картинка вариации) — передавать ровно одно из attach_to_*. file_url — из bragi_asset_up, если файла ещё нет в хранилище.' },
  { name: 'bragi_keyword_set', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/keyword',
    params: 'keyword_id, phrase?, cluster?, freq_exact?, freq_broad?, source?, intent?, region_engine?, measured_at?, page_id?, rubric_id?',
    desc: 'BragiKeyword: создать/дополнить ключевую фразу (upsert по keyword_id). page_id → ребро TARGETS_PAGE на существующую BragiPage. rubric_id — ОДНА рубрика через IN_RUBRIC, заменяет прежнюю (не аддитивно).' },
  { name: 'bragi_page_set', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/page',
    params: 'page_id, url?, title?, description?, page_type?, deployed_at?',
    desc: 'BragiPage: создать/дополнить целевую страницу (upsert по page_id).' },
  { name: 'bragi_campaign_new', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/campaign',
    params: 'campaign_id, utm_source?, utm_medium?, utm_campaign?, target_url?, period?, variant_id?',
    desc: 'BragiCampaign: создать/дополнить UTM-кампанию (upsert по campaign_id). variant_id → ребро FOR_VARIANT на существующую BragiVariant.' },
  { name: 'metric_log', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/metric',
    params: 'object_type, object_id, metric, value, ts?, source?, segment?',
    desc: 'MetricSnapshot: добавить одно измерение в TIMESERIES-хранилище BRAGI (нативный ArcadeDB time-series, не граф-вершина — без рёбер, привязка через теги object_type+object_id). ts принимает ISO-8601 или epoch millis, по умолчанию now(). Только запись — удаления/правки нет (immutable sealed-store).' },
  { name: 'metric_get', kind: 'read', entity: 'BRAGI', backend: 'GET /lore/bragi/metric/query',
    params: 'object_type?, object_id?, metric?, from?, to?, agg?, limit?',
    desc: 'Чтение точек MetricSnapshot с фильтрами и опциональной агрегацией (agg: avg|sum|min|max|count, группировка по object_type+object_id+metric). Без agg — до limit сырых точек, новые сверху. object_type="probe" (артефакт проверки схемы ARC-02/03) всегда исключён.' },
  { name: 'bragi_integration_new', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/integration',
    params: 'integration_id, service?, purpose?, endpoint?, scope?, secret_ref?, status?, last_called_at?',
    desc: 'BragiIntegration: создать/дополнить коннектор (upsert по integration_id). ⚠️ secret_ref обязан быть ссылкой ("env:X" / "vault:X" / "oauth:X" / "secret:X") — бэкенд отклоняет любое другое значение (400), значение токена в граф не попадает никогда.' },
  { name: 'insight_new', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/insight',
    params: 'insight_id, statement_md?, insight_date?, evidence_ref?',
    desc: 'BragiInsight: создать/дополнить вывод из данных (upsert по insight_id). evidence_ref — свободный текст-указатель на замеры (у MetricSnapshot нет графовых рёбер). Для связи с задачей/ADR — insight_link.' },
  { name: 'insight_link', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/insight/link',
    params: 'insight_id, rel (task|adr), target_id',
    desc: 'Ребро LED_TO от существующего BragiInsight к KnowTask или KnowADR (rel = task | adr, target_id = task_uid | adr_id) — зафиксировать, что инсайт привёл к конкретному действию. Идемпотентно. rel — переименованный target_type (T02), для симметрии с другими *_link тулами.' },
  { name: 'bragi_link', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/rubric/link, POST /lore/bragi/link',
    params: 'rel (rubric|produced_by|shipped_in), entity_type (publication|keyword|variant), entity_id, target_type?, target_id, git_project?, action?',
    desc: 'Link-collapse (T02, 2→1 — самая сложная свёртка: у каждого старого тула была своя ось entity_type независимо от типа ребра, разрешено через то, что rel = ребро/назначение, а entity_type/target_type — параметры, зависящие от rel). rel="rubric" — назначает (заменяет) ОДНУ рубрику через IN_RUBRIC, entity_type: publication|keyword, target_id=rubric_id. rel="produced_by" — ребро PRODUCED_BY в рабочий граф Forseti, entity_type: publication|variant, target_type: task|sprint, target_id=task_uid или sprint_id. rel="shipped_in" — ребро SHIPPED_IN, entity_type: publication|variant, target_id=release_id/tag, передавать git_project для multi-repo (release_uid = "{git_project}#{target_id}"). Идемпотентно на add.' },
  { name: 'bragi_sync', kind: 'write', entity: 'BRAGI', backend: 'POST /lore/bragi/integration/sync',
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
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"query_slice","arguments":{"slice":"plan_config"}}}' \\
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
            <code style={S.code}>adr_new</code> {t('lore.mcpApi.toolsNote4', 'создаёт полную SCD2-структуру: вершина + KnowADRHist (valid_to=null) + HAS_STATE edge — тело ADR читается именно из hist-строки.')}{' '}
            {t('lore.mcpApi.toolsNote5', 'Партиальные (amend) вызовы у всех upsert-инструментов с 2026-07 безопасны — SQL SET собирается динамически, непереданное поле не трогается (раньше пропущенный параметр молча обнулялся).')}{' '}
            {t('lore.mcpApi.toolsNoteRoles', 'Задачи несут author/executor/reviewer_agent (ADR-LORE-014 §4) — единственный жёсткий SDLC-гейт: reviewer_agent должен отличаться от executor_agent, иначе')}{' '}
            <code style={S.code}>status_set</code> {t('lore.mcpApi.toolsNoteRoles2', 'task→done отклоняется (409 NO_SELF_ACCEPTANCE). Значения ролей — расширяемый справочник')}{' '}
            <code style={S.code}>agent_role</code> {t('lore.mcpApi.toolsNoteRoles3', '(см. Dictionary ниже) — UI сам регистрирует новую роль в словаре при первом вводе.')}{' '}
            <b>{t('lore.mcpApi.toolsNoteDeletionLabel', 'Удаление:')}</b> {t('lore.mcpApi.toolsNote6', 'штатный путь — soft-delete через статус (')}<code style={S.code}>status_set</code>
            {t('lore.mcpApi.toolsNote7', ' со status="cancelled"/"deprecated"/"archived" — история сохраняется). Настоящий hard-delete есть только у ')}<code style={S.code}>adr_del</code> {t('lore.mcpApi.toolsNote8', 'и')}{' '}
            <code style={S.code}>spec_del</code>, {t('lore.mcpApi.toolsNote9', 'оба явно помечены как «только для тестовых артефактов». Остальные типы (Sprint/Task/Release/Component/Milestone/ QualityGate/Runbook/Doc) осознанно без hard-delete тула — реальные данные не удаляются, только архивируются статусом.')}{' '}
            {t('lore.mcpApi.toolsNote10', 'Из набора пока не реализован только ')}<code style={S.code}>checkpoint</code> {t('lore.mcpApi.toolsNote11', '(бэкенд → 501). Инструменты по ')}<b>{t('lore.mcpApi.researchLabel', 'Исследованиям')}</b> {t('lore.mcpApi.toolsNote12', '(витрина RAGVSDL) — на отдельной странице «MCP API» в разделе «Исследования» (')}<code style={S.code}>/benchmark?tab=mcp</code>{t('lore.mcpApi.toolsNote13', ').')}
          </p>
        </Section>

        {/* ── Live slice catalog ─────────────────────────────────────────────── */}
        <Section title={slices ? t('lore.mcpApi.sliceCatalogTitleCount', 'Каталог слайсов · {{count}}', { count: slices.length }) : t('lore.mcpApi.sliceCatalogTitle', 'Каталог слайсов')}>
          <p style={S.note}>
            {t('lore.mcpApi.sliceCatalogNote1', 'То, что отдаёт')} <code style={S.codeAcc}>list_slices</code> {t('lore.mcpApi.sliceCatalogNote2', '— живой whitelist параметризованных запросов. Каждый слайс зовётся через')}{' '}
            <code style={S.codeAcc}>query_slice</code>.
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
      fontSize: 'var(--fs-sm)', padding: '3px 10px', borderRadius: 20,
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
      fontSize: 'var(--fs-xs)', padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
      background: `color-mix(in srgb, ${c} 16%, transparent)`,
      color: c, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
    }}>{kind}</span>
  );
}

function Node({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span style={{
      padding: '4px 10px', borderRadius: 5, fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap',
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
      <span style={{ fontSize: 'var(--fs-2xs)', lineHeight: 1 }}>{label}</span>
      <span style={{ fontSize: 'var(--fs-md)', lineHeight: 1 }}>→</span>
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
    padding: '3px 9px', borderRadius: 20, fontSize: 'var(--fs-sm)', cursor: 'pointer', userSelect: 'none',
    fontFamily: 'var(--mono)',
    background: active ? 'color-mix(in srgb, var(--acc) 16%, transparent)' : 'var(--b1)',
    color: active ? 'var(--acc)' : 'var(--t2)',
    border: `1px solid ${active ? 'color-mix(in srgb, var(--acc) 35%, transparent)' : 'var(--bd)'}`,
  };
}
function kindChipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '3px 9px', borderRadius: 20, fontSize: 'var(--fs-sm)', cursor: 'pointer', userSelect: 'none',
    background: active ? 'var(--b3)' : 'transparent',
    color: active ? 'var(--t1)' : 'var(--t3)',
    border: `1px solid ${active ? 'var(--bdh)' : 'transparent'}`,
  };
}

const S: Record<string, React.CSSProperties> = {
  scroll:  { flex: 1, overflowY: 'auto', fontFamily: 'var(--font)' },
  wrap:    { maxWidth: 920, margin: '0 auto', padding: '22px 26px 60px' },
  head:    { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  h1:      { fontSize: 'var(--fs-2xl)', fontWeight: 700, fontFamily: 'var(--display)', color: 'var(--t1)' },
  h2:      { fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--t1)', marginBottom: 10,
             paddingBottom: 5, borderBottom: '1px solid var(--bd)' },
  lead:    { marginTop: 12, fontSize: 'var(--fs-md)', lineHeight: 1.65, color: 'var(--t2)' },
  pipe:    { marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 6 },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-base)' },
  th:      { textAlign: 'left', padding: '7px 10px', color: 'var(--t3)', fontWeight: 600,
             fontSize: 'var(--fs-sm)', borderBottom: '1px solid var(--bd)', background: 'var(--b1)',
             whiteSpace: 'nowrap' },
  tr:      { borderBottom: '1px solid var(--bd)' },
  td:      { padding: '7px 10px', verticalAlign: 'top', color: 'var(--t1)' },
  note:    { marginTop: 10, fontSize: 'var(--fs-base)', lineHeight: 1.6, color: 'var(--t3)' },
  code:    { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', padding: '1px 5px', borderRadius: 3,
             background: 'var(--b2)', color: 'var(--t2)' },
  codeAcc: { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', padding: '1px 5px', borderRadius: 3,
             background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)' },
  pre:     { marginTop: 8, padding: '10px 12px', borderRadius: 6, overflowX: 'auto',
             background: 'var(--b1)', border: '1px solid var(--bd)',
             fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, color: 'var(--t2)',
             whiteSpace: 'pre' },
  ol:      { marginTop: 4, paddingLeft: 20, fontSize: 'var(--fs-base)', lineHeight: 1.7, color: 'var(--t2)',
             display: 'flex', flexDirection: 'column', gap: 6 },
  filter:  { marginTop: 10, width: '100%', maxWidth: 320, height: 28, padding: '0 10px',
             background: 'var(--b1)', border: '1px solid var(--b3)', borderRadius: 5,
             color: 'var(--t1)', fontSize: 'var(--fs-base)', fontFamily: 'inherit', outline: 'none' },
  chips:   { marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip:    { display: 'inline-flex', alignItems: 'center', gap: 4,
             padding: '3px 4px', borderRadius: 4, background: 'var(--b1)',
             border: '1px solid var(--bd)' },
  req:     { fontSize: 'var(--fs-xs)', color: 'var(--wrn)' },
  opt:     { fontSize: 'var(--fs-xs)', color: 'var(--t3)' },
  down:    { marginTop: 10, padding: '10px 12px', borderRadius: 6, fontSize: 'var(--fs-base)',
             background: 'color-mix(in srgb, var(--dng) 10%, transparent)',
             border: '1px solid color-mix(in srgb, var(--dng) 30%, transparent)',
             color: 'var(--t2)' },
  foot:    { marginTop: 30, fontSize: 'var(--fs-sm)', color: 'var(--t3)', lineHeight: 1.7,
             paddingTop: 12, borderTop: '1px solid var(--bd)' },

  // Entity/kind filter chips above the tools table.
  entityChips: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10 },
  entityChipCount: { fontSize: 'var(--fs-2xs)', opacity: 0.7 },
  kindToggle: { display: 'inline-flex', gap: 4, marginLeft: 8, paddingLeft: 8, borderLeft: '1px solid var(--bd)' },

  // Group header row within the tools table.
  trGroup: { background: 'var(--b1)' },
  tdGroup: { padding: '5px 10px', fontSize: 'var(--fs-xs)', fontWeight: 700, textTransform: 'uppercase' as const,
             letterSpacing: '0.06em', color: 'var(--acc)' },

  // Params column: one param per line instead of one squashed string.
  paramList: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  paramReq:  { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--t1)' },
  paramOpt:  { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--t3)' },
};
