// Адаптеры «существующие слайсы → запись kit» для демо паспортов (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-33).
// ВРЕМЕННО: пока на бэкенде нет реестра полей и фасада /lore/record (SPEC-LORE-UXR-RECORD-CONTRACT),
// поля типа описаны здесь. Когда придут контракты по объектам (docs/reports/lore-object-contracts.md)
// и реестр — эти описания заменяются ответом сервера, раскладка kit не меняется.
// Честность: упавший дополнительный слайс — meta.errors блока, а не «пусто».
import type { KitConfig, KitData, KitEdge, KitLang, KitRecord } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import type { SliceBody } from '../api/loreSlice';
import { loreEdgesConfig } from './loreEdges';
import { planStatusOf } from '../sprints/taskStatus';
import { loreStatuses, sprintKitData, SPRINT_FACTS, type SprintSliceRow, type SprintTaskSliceRow } from './loreRecord';

export const PASSPORT_TYPES = ['sprint', 'task', 'adr', 'spec'] as const;
export type PassportType = (typeof PASSPORT_TYPES)[number];

type Slice = <T>(slice: string, params?: Record<string, string>) => Promise<SliceBody<T>>;
type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const norm = (raw: unknown) => str(raw).replace(/[^\p{L}\p{N}_ ]/gu, '').trim().toLowerCase().replace(/\s+/g, '_');
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface PassportLoad { record: KitRecord; data: KitData; config: KitConfig; facts?: typeof SPRINT_FACTS }

/** Конфиг вида: поля, статусы LORE, подписи рёбер. */
export function baseConfig(lang: KitLang, kinds: KitConfig['kinds']): KitConfig {
  return {
    modules: [], menu: { groups: [] }, kinds,
    edges: loreEdgesConfig(lang),
    graph: { depth: 1, limit: 60, colorBy: 'type' },
    statuses: loreStatuses(lang),
    roles: { reader: { canEdit: false, canStatus: false } },
  };
}
const f = (lang: KitLang, key: string) => appT(lang, `pp.field.${key}` as AppKey);
const refsTo = (from: string, ids: string[], type: string): KitEdge[] => ids.map(to => ({ from, to, type }));
const stubs = (ids: string[], kind: string): KitRecord[] => ids.map(id => ({ id, kind, title: id, status: '', fields: {} }));

/** Список записей типа — для выбора в демо. */
export async function listOf(type: PassportType, slice: Slice): Promise<{ id: string; title: string }[]> {
  if (type === 'sprint') return (await slice<Row>('sprints', { fields: 'sprint_id,name', limit: '1000' })).rows.map(r => ({ id: str(r.sprint_id), title: str(r.name) || str(r.sprint_id) }));
  if (type === 'adr') return (await slice<Row>('adrs', { fields: 'adr_id,name', limit: '1000' })).rows.map(r => ({ id: str(r.adr_id), title: str(r.name) || str(r.adr_id) }));
  if (type === 'spec') return (await slice<Row>('specs', { fields: 'spec_id,title', limit: '1000' })).rows.map(r => ({ id: str(r.spec_id), title: str(r.title) || str(r.spec_id) }));
  return (await slice<Row>('open_tasks', { fields: 'task_uid,title', limit: '300' })).rows.map(r => ({ id: str(r.task_uid), title: str(r.title) || str(r.task_uid) }));
}

export async function loadPassport(type: PassportType, id: string, lang: KitLang, slice: Slice, now = new Date().toISOString()): Promise<PassportLoad> {
  if (type === 'sprint') return loadSprint(id, lang, slice, now);
  if (type === 'adr') return loadAdr(id, lang, slice, now);
  if (type === 'spec') return loadSpec(id, lang, slice, now);
  return loadTask(id, lang, slice, now);
}

async function loadSprint(id: string, lang: KitLang, slice: Slice, now: string): Promise<PassportLoad> {
  const rows = (await slice<Row>('sprints', { limit: '1000' })).rows;
  const row = rows.find(r => r.sprint_id === id);
  if (!row) throw new Error(appT(lang, 'pp.notFound', { id }));
  let tasks: SprintTaskSliceRow[] | { error: string };
  try { tasks = (await slice<SprintTaskSliceRow>('tasks_of_sprint', { sprint_id: id })).rows; } catch (e) { tasks = { error: errText(e) }; }
  const { record, data } = sprintKitData(row as unknown as SprintSliceRow, tasks, now);
  record.status = planStatusOf(str(row.status_raw));
  Object.assign(record.fields, {
    priority: str(row.priority) || null, projects: arr(row.git_projects), components: arr(row.components),
    releases: arr(row.release_ids), milestones: arr(row.milestone_ids),
    planned_start: str(row.planned_start_date) || null, planned_end_date: str(row.planned_end_date) || null,
    created: str(row.created_date).slice(0, 10) || null,
    no_release: row.no_release_required === true ? appT(lang, 'pp.yes') : null,
  });
  data.edges.push(...refsTo(id, arr(row.git_projects), 'BELONGS_TO_PROJECT'), ...refsTo(id, arr(row.components), 'BELONGS_TO'));
  const config = baseConfig(lang, {
    Sprint: {
      title: appT(lang, 'pp.kind.sprint'), icon: 'sprint',
      fields: [
        // Как в v1 (S4-36): сверху — общее; «Планирование» и «Модули» — разделами.
        { key: 'priority', title: f(lang, 'priority'), type: 'enum' },
        { key: 'projects', title: f(lang, 'projects'), type: 'ref' },
        { key: 'releases', title: f(lang, 'releases'), type: 'ref' },
        { key: 'created', title: f(lang, 'created'), type: 'date', section: appT(lang, 'pp.sec.plan') },
        { key: 'milestones', title: f(lang, 'milestones'), type: 'ref', section: appT(lang, 'pp.sec.plan') },
        { key: 'planned_start', title: f(lang, 'plannedStart'), type: 'date', section: appT(lang, 'pp.sec.plan') },
        { key: 'planned_end_date', title: f(lang, 'plannedEnd'), type: 'date', section: appT(lang, 'pp.sec.plan') },
        { key: 'no_release', title: f(lang, 'noRelease'), type: 'text', section: appT(lang, 'pp.sec.plan') },
        { key: 'components', title: f(lang, 'components'), type: 'ref', section: appT(lang, 'pp.sec.modules') },
      ],
      tabs: [{ key: 'tasks', title: appT(lang, 'pp.tab.tasks'), render: (r, ctx) => ctx.data.edges.filter(e => e.from === r.id && e.type === 'HAS_TASK').map(e => ctx.data.records.find(x => x.id === e.to)?.title ?? e.to).join(' · ') || appT(lang, 'pp.noTasks') }],
    },
    Task: { title: appT(lang, 'pp.kind.task'), icon: 'checkbox-tree' },
  });
  return { record, data, config, facts: SPRINT_FACTS };
}

async function loadTask(uid: string, lang: KitLang, slice: Slice, now: string): Promise<PassportLoad> {
  const row = (await slice<Row>('tasks_by_uids', { task_uids: uid })).rows[0];
  if (!row) throw new Error(appT(lang, 'pp.notFound', { id: uid }));
  const sprint = str(row.sprint_id);
  const record: KitRecord = {
    id: uid, kind: 'task', title: str(row.title) || uid, status: planStatusOf(str(row.status_raw)),
    body_md: str(row.note_md) || undefined,
    fields: {
      sprint: sprint || null, components: arr(row.component_ids), effort: row.effort_days ?? null, actual: row.actual_days ?? null,
      author: str(row.author_agent) || null, executor: str(row.executor_agent) || null, reviewer: str(row.reviewer_agent) || null,
      task_type: str(row.task_type) || null, work_class: str(row.work_class) || null, prs: arr(row.closed_by_prs),
    },
  };
  const edges = [...refsTo(uid, sprint ? [sprint] : [], 'PART_OF'), ...refsTo(uid, arr(row.component_ids), 'TAGGED_WITH')];
  const config = baseConfig(lang, {
    task: {
      title: appT(lang, 'pp.kind.task'), icon: 'checkbox-tree',
      fields: [
        { key: 'sprint', title: f(lang, 'sprint'), type: 'ref' },
        { key: 'task_type', title: f(lang, 'taskType'), type: 'enum' },
        { key: 'work_class', title: f(lang, 'workClass'), type: 'enum' },
        { key: 'effort', title: f(lang, 'effort'), type: 'number' },
        { key: 'actual', title: f(lang, 'actual'), type: 'number' },
        { key: 'author', title: f(lang, 'author'), type: 'text' },
        { key: 'executor', title: f(lang, 'executor'), type: 'text' },
        { key: 'reviewer', title: f(lang, 'reviewer'), type: 'text' },
        { key: 'components', title: f(lang, 'components'), type: 'ref' },
        { key: 'prs', title: f(lang, 'prs'), type: 'ref' },
      ],
    },
  });
  return { record, data: { records: [record, ...stubs(sprint ? [sprint] : [], 'Sprint')], edges, journal: [], meta: { generated_at: now } }, config };
}

async function loadAdr(id: string, lang: KitLang, slice: Slice, now: string): Promise<PassportLoad> {
  const row = (await slice<Row>('adr', { id })).rows[0];
  if (!row) throw new Error(appT(lang, 'pp.notFound', { id }));
  const record: KitRecord = {
    id, kind: 'adr', title: str(row.name) || id, status: norm(row.status),
    updated_at: str(row.hist_valid_from) || undefined,
    fields: {
      // Текст ADR — тремя разделами, как в v1, а не склейкой через «## Контекст» (08.11).
      context_md: str(row.context_md).trim() || null, decision_md: str(row.decision_md).trim() || null, consequences_md: str(row.consequences_md).trim() || null,
      date: str(row.date_created) || null, components: arr(row.components), projects: arr(row.git_projects), tags: arr(row.tags).join(', ') || null,
      depends_on: arr(row.depends_on_ids), supersedes: arr(row.supersedes_ids), file_path: str(row.file_path) || null,
    },
  };
  const edges: KitEdge[] = [
    ...refsTo(id, arr(row.depends_on_ids), 'DEPENDS_ON'), ...refsTo(id, arr(row.supersedes_ids), 'SUPERSEDES'),
    ...arr(row.superseded_by_ids).map(from => ({ from, to: id, type: 'SUPERSEDES' })),
    ...arr(row.justified_task_uids).map(from => ({ from, to: id, type: 'JUSTIFIED_BY' })),
    ...refsTo(id, arr(row.git_projects), 'BELONGS_TO_PROJECT'),
  ];
  let decisions: Row[] = [];
  const errors: { block: string; reason: string }[] = [];
  try { decisions = (await slice<Row>('decisions_of_adr', { id })).rows; } catch (e) { errors.push({ block: 'decisions', reason: errText(e) }); }
  const decRecords: KitRecord[] = decisions.map(d => ({ id: str(d.decision_id) || str(d.id), kind: 'decision', title: str(d.title) || str(d.decision_id), status: norm(d.status), fields: {} }));
  edges.push(...decRecords.map(d => ({ from: d.id, to: id, type: 'DECIDED_IN' })));
  const ids = new Set([id, ...decRecords.map(d => d.id)]);
  const others = [...new Set(edges.flatMap(e => [e.from, e.to]))].filter(x => !ids.has(x));
  const config = baseConfig(lang, {
    adr: {
      title: 'ADR', icon: 'scroll-quill',
      fields: [
        { key: 'context_md', title: appT(lang, 'pp.adr.context'), type: 'md' },
        { key: 'decision_md', title: appT(lang, 'pp.adr.decision'), type: 'md' },
        { key: 'consequences_md', title: appT(lang, 'pp.adr.consequences'), type: 'md' },
        { key: 'date', title: f(lang, 'date'), type: 'date' },
        { key: 'projects', title: f(lang, 'projects'), type: 'ref' },
        { key: 'components', title: f(lang, 'components'), type: 'ref' },
        { key: 'depends_on', title: f(lang, 'dependsOn'), type: 'ref' },
        { key: 'supersedes', title: f(lang, 'supersedes'), type: 'ref' },
        { key: 'tags', title: f(lang, 'tags'), type: 'text' },
        { key: 'file_path', title: f(lang, 'file'), type: 'text' },
      ],
      tabs: [{ key: 'decisions', title: appT(lang, 'pp.tab.decisions'), render: () => decRecords.map(d => d.title).join(' · ') || appT(lang, 'pp.noDecisions') }],
    },
    decision: { title: appT(lang, 'pp.kind.decision'), icon: 'gavel' },
  });
  return { record, data: { records: [record, ...decRecords, ...stubs(others, 'ref')], edges, journal: [], meta: { generated_at: now, ...(errors.length ? { errors } : {}) } }, config };
}

async function loadSpec(id: string, lang: KitLang, slice: Slice, now: string): Promise<PassportLoad> {
  const row = (await slice<Row>('spec_by_id', { id })).rows[0];
  if (!row) throw new Error(appT(lang, 'pp.notFound', { id }));
  const record: KitRecord = {
    id, kind: 'spec', title: str(row.title) || id, status: norm(row.status) || 'proposed',
    body_md: str(row.content_md) || undefined, updated_at: str(row.valid_from) || undefined,
    fields: { version: str(row.version) || null, summary: str(row.summary) || null, projects: arr(row.projects), component: str(row.component_id) || null, file_path: str(row.file_path) || null },
  };
  const edges = [...refsTo(id, arr(row.projects), 'BELONGS_TO_PROJECT'), ...refsTo(id, str(row.component_id) ? [str(row.component_id)] : [], 'BELONGS_TO')];
  const config = baseConfig(lang, {
    spec: {
      title: appT(lang, 'pp.kind.spec'), icon: 'spell-book',
      fields: [
        { key: 'version', title: f(lang, 'version'), type: 'text' },
        { key: 'summary', title: f(lang, 'summary'), type: 'md' },
        { key: 'projects', title: f(lang, 'projects'), type: 'ref' },
        { key: 'component', title: f(lang, 'component'), type: 'ref' },
        { key: 'file_path', title: f(lang, 'file'), type: 'text' },
      ],
    },
  });
  return { record, data: { records: [record], edges, journal: [], meta: { generated_at: now } }, config };
}
