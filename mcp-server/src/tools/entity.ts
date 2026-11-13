// SPRINT_LORE_MCP_V2/MCPV2-3 — консолидация CRUD: 4 обобщённых инструмента
// (entity_upsert / entity_link / entity_delete / entity_move) вместо ~60
// per-entity вариаций «создай / обнови / свяжи / удали / перемести сущность».
// Повод: 208 инструментов суммарно роняли субагентов («tools is invalid or too
// large»); профильная выдача (MCPV2-1/2) сузила выдачу, этот шаг уменьшает
// саму ДЕФОЛТНУЮ full-поверхность по числу инструментов.
//
// Диспетчер НЕ вводит нового сетевого кода: каждая ветка таблиц ниже идёт тем
// же lorePost на тот же path с той же формой body, что и перекрытый инструмент
// (паритет путей фиксируют toolPaths.test.ts → agent-profiles/tool-paths.json
// и entity.test.ts). Валидация полей — бэкендом, как и у def-таблицы
// loreWrite.ts: fields — свободная запись, схема знает только type/id.
//
// ── Семантика совместимости (точная) ───────────────────────────────────────
//   LORE_MCP_LEGACY=1              → полная старая поверхность + entity_*;
//   профиль ≠ full (env или токен) → старые имена доступны в рамках профиля
//                                    (agent-profiles/*.json ссылаются на них —
//                                    developer по-прежнему видит task_*),
//                                    entity_* разрешён только если профиль
//                                    разрешает запись — иначе profile gate
//                                    сам скроет (сейчас профили entity_* НЕ
//                                    содержат: см. находку в MIGRATION.md);
//   дефолт (full, без осей)        → покрытые старые имена (LEGACY_CRUD_TOOLS)
//                                    скрыты, работа идёт через entity_*.
// Композиция — legacySurfaceGate ниже; index.ts подменяет ей гейт профиля.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ACTIVE_PROJECT, lorePost } from '../backend.js';
import {
  err,
  inlineProject,
  json,
  projectMissing,
  projectRequired,
  QUESTION_CLOSE_GUIDANCE,
  similarQuestions,
  type ProjectKind,
} from './loreWrite.js';

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const omit = (o: Record<string, unknown>, k: string): Record<string, unknown> => {
  const { [k]: _drop, ...rest } = o;
  return rest;
};

// ── entity_upsert: type → тот же path/body, что у перекрытых *_new/_set ─────

type UpsertDef = {
  /** ключ id в body; undefined = составной id (части едут в fields, id не принимается) */
  idField?: string;
  /** подсказка о частях составного id для текста отказа */
  idHint?: string;
  path: string;
  /** kind для inlineProject-ребра BELONGS_TO_PROJECT после записи (AL-113) */
  project?: ProjectKind;
  /** вырезать fields.project из body (он уходит в inlineProject, а не в запись) */
  stripProject?: boolean;
  /** отказ до записи без project/LORE_ACTIVE_PROJECT (паритет с *_new, анти-сироты 05.11) */
  guardProject?: boolean;
  /** decision: guard снимается, когда задан fields.adr_id (проект придёт через родителя) */
  guardUnlessAdr?: boolean;
  /** question: status="closed" отбивается с guidance (закрытие — только через answers-ребро) */
  refuseClosed?: boolean;
  /** dict: fields.human_approval уходит заголовком X-Lore-Human-Approval, не телом */
  humanApproval?: boolean;
  /** своя сборка body (по умолчанию: fields + id); строка результата = текст отказа */
  build?: (id: string | undefined, fields: Record<string, unknown>) => Record<string, unknown> | string;
  /** свой второй шаг после записи (по умолчанию для project-kind: inlineProject) */
  after?: (id: string | undefined, fields: Record<string, unknown>, project?: string) => Promise<Record<string, unknown>>;
  /** старые имена, которые эта ветка заменяет (скрываются по умолчанию) */
  replaces: string[];
};

const techSpecId = (f: Record<string, unknown>): string =>
  `SPEC-TECH-${String(f.component_id ?? '').toUpperCase()}-${String(f.tech_name ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;

// Порядок типов в enum — не алфавитный произвол: ПЕРВЫЙ обязан быть типом без
// project-guard'а — contract.test.ts зовёт каждый инструмент с базовым вариантом
// (первое значение enum), и вызов с guard-типом вернул бы isError при ok-бэкенде.
const UPSERT_DEFS = {
  actor: {
    idField: 'actor_id', path: '/lore/actor', replaces: ['actor_new'],
    build: (id, f) => ({
      ...omit(f, 'projects'), actor_id: id,
      // Паритет actor_new: project шлётся явным null, projects — только когда ключ
      // передан (бэкенд различает «ключа нет» и «пустой список»).
      project: f.project ?? null,
      ...(f.projects === undefined ? {} : { projects: f.projects }),
    }),
  },
  adr: {
    idField: 'adr_id', path: '/lore/adr', project: 'adr', stripProject: true, guardProject: true,
    replaces: ['adr_new', 'adr_set'],
  },
  bragi_campaign: { idField: 'campaign_id', path: '/lore/bragi/campaign', replaces: ['bragi_campaign_new'] },
  bragi_channel: { idField: 'channel_id', path: '/lore/bragi/channel', replaces: ['bragi_channel_set'] },
  bragi_integration: { idField: 'integration_id', path: '/lore/bragi/integration', replaces: ['bragi_integration_new'] },
  bragi_keyword: { idField: 'keyword_id', path: '/lore/bragi/keyword', replaces: ['bragi_keyword_set'] },
  bragi_page: { idField: 'page_id', path: '/lore/bragi/page', replaces: ['bragi_page_set'] },
  bragi_publication: { idField: 'publication_id', path: '/lore/bragi/publication', replaces: ['bragi_pub_new'] },
  bragi_rubric: { idField: 'rubric_id', path: '/lore/bragi/rubric', replaces: ['bragi_rubric_set'] },
  bragi_variant: { idField: 'variant_id', path: '/lore/bragi/variant', replaces: ['bragi_variant_new'] },
  component: { idField: 'component_id', path: '/lore/component/create', replaces: ['component_new'] },
  decision: {
    idField: 'decision_id', path: '/lore/decision', replaces: ['decision_new'],
    guardUnlessAdr: true,
    // Паритет decision_new: project едет в body с фолбэком на проект сессии.
    build: (id, f) => ({ ...f, decision_id: id, project: f.project ?? ACTIVE_PROJECT ?? null }),
  },
  dict: {
    path: '/lore/dict/entry', idHint: 'dict_type + code', humanApproval: true, replaces: ['dict_set'],
    build: (_id, f) => omit(f, 'human_approval'),
  },
  doc: {
    idField: 'doc_id', path: '/lore/doc', project: 'doc', stripProject: true, guardProject: true,
    replaces: ['doc_new'],
  },
  feature: {
    idField: 'feature_id', path: '/lore/feature', project: 'uc', stripProject: true, guardProject: true,
    replaces: ['feature_new'],
  },
  gain: { idField: 'gain_id', path: '/lore/gain', replaces: ['gain_new'] },
  insight: { idField: 'insight_id', path: '/lore/bragi/insight', replaces: ['insight_new'] },
  job: { idField: 'job_id', path: '/lore/job', replaces: ['job_new'] },
  milestone: { idField: 'milestone_id', path: '/lore/milestone', replaces: ['milestone_new', 'milestone_set'] },
  pain: { idField: 'pain_id', path: '/lore/pain', replaces: ['pain_new'] },
  phase: { path: '/lore/phase', idHint: 'sprint_id + phase_key', replaces: ['sprint_phase_new'] },
  project: {
    idField: 'slug', path: '/lore/project', replaces: ['project_new'],
    // Паритет project_new: hosts хранится JSON-строкой; absent → null, как раньше.
    build: (id, f) => ({ ...f, slug: id, hosts: f.hosts ? JSON.stringify(f.hosts) : null }),
  },
  project_actor: {
    idField: 'actor_id', path: '/lore/project-actor', replaces: ['project_actor_new'],
    build: (id, f) => ({
      ...omit(f, 'projects'), actor_id: id,
      project: f.project ?? null,
      ...(f.projects === undefined ? {} : { projects: f.projects }),
    }),
  },
  question: {
    idField: 'question_id', path: '/lore/question', project: 'question', stripProject: true,
    guardProject: true, refuseClosed: true, replaces: ['question_new', 'question_set'],
    after: (id, f, project) => Promise.all([
      inlineProject('question', id!, project),
      similarQuestions(id!, str(f.title)),
    ]).then(([p, s]) => ({ ...p, ...s })),
  },
  release: { idField: 'release_id', path: '/lore/release', replaces: ['release_new'] },
  runbook: {
    idField: 'runbook_id', path: '/lore/runbook', project: 'runbook', stripProject: true, guardProject: true,
    replaces: ['runbook_new'],
  },
  spec: {
    idField: 'spec_id', path: '/lore/spec', project: 'spec', stripProject: true, guardProject: true,
    replaces: ['spec_new', 'spec_set'],
  },
  sprint: {
    idField: 'sprint_id', path: '/lore/sprint/create', replaces: ['sprint_new'],
    // Паритет sprint_new: status по умолчанию 'todo' (client-side default старого
    // инструмента), project/git_project → git_project с фолбэком на сессию.
    build: (id, f) => {
      const { project, git_project, ...rest } = f;
      return { ...rest, sprint_id: id, status: f.status ?? 'todo', git_project: git_project ?? project ?? ACTIVE_PROJECT ?? null };
    },
  },
  task: {
    path: '/lore/task', idHint: 'SPRINT_X/T05', replaces: ['task_new'],
    // task_new требует пару sprint_id+task_id; uid "SPRINT_X/T05" делится на них.
    build: (id, f) => {
      const m = /^([^/]+)\/([^/]+)$/.exec(id ?? '');
      if (!m) return `id for type="task" must be the task uid "SPRINT_X/T05" (sprint_id/task_id) — got ${JSON.stringify(id ?? null)}`;
      return { ...f, sprint_id: m[1], task_id: m[2] };
    },
  },
  tech: {
    path: '/lore/spec', idHint: 'component_id + tech_name + version', project: 'spec', stripProject: true,
    guardProject: true, replaces: ['tech_set'],
    build: (_id, f) => {
      const today = new Date().toISOString().slice(0, 10);
      const lines = [
        f.release_date && `- **Дата релиза:** ${f.release_date}`,
        f.our_release && `- **Наш релиз:** ${f.our_release}`,
        f.license && `- **Лицензия:** ${f.license}`,
        f.usage && `- **Использование:** ${f.usage}`,
        f.source_url && `- **Источник:** ${f.source_url}`,
        `- **Проверено:** ${f.checked_at ?? today}`,
      ].filter(Boolean);
      return { spec_id: techSpecId(f), title: f.tech_name, version: f.version, component_id: f.component_id, content_md: lines.join('\n') };
    },
    after: (_id, f, project) => inlineProject('spec', techSpecId(f), project),
  },
  uc: {
    idField: 'uc_id', path: '/lore/uc', project: 'uc', stripProject: true, guardProject: true,
    replaces: ['uc_new'],
  },
} satisfies Record<string, UpsertDef>;

type UpsertType = keyof typeof UPSERT_DEFS;
const UPSERT_TYPES = Object.keys(UPSERT_DEFS) as [UpsertType, ...UpsertType[]];

const upsertIdHint = (t: UpsertType): string => {
  const d: UpsertDef = UPSERT_DEFS[t];
  return d.idField ?? d.idHint ?? '—';
};

// ── entity_link: (type, rel) → тот же path/body, что у *_link-collapse ──────

type LinkResult = { path: string; body: Record<string, unknown> };
type LinkAction = 'add' | 'remove' | undefined;

const needTarget = (targetId: unknown, rel: string): string | null =>
  targetId === undefined || targetId === null || targetId === ''
    ? `target_id required for rel="${rel}"`
    : null;

/** target_id у release — одиночный или массив (старый release_link брал ids[]). */
const asIds = (targetId: unknown): (string | number)[] =>
  Array.isArray(targetId) ? (targetId as (string | number)[]) : targetId !== undefined ? [targetId as string | number] : [];

function bragiForsetiLink(entityType: 'publication' | 'variant', id: string, rel: string, t: unknown, action: string, f: Record<string, unknown>): LinkResult {
  const edge_type = rel === 'produced_by' ? 'PRODUCED_BY' : 'SHIPPED_IN';
  const target_type = rel === 'produced_by' ? (f.target_type ?? 'task') : 'release';
  return {
    path: '/lore/bragi/link',
    body: { entity_type: entityType, entity_id: id, edge_type, target_type, target_id: t, git_project: f.git_project ?? null, action },
  };
}

// Первый тип (adr) и первый rel ('sprint') образуют валидную пару: contract.test.ts
// зовёт базовый вариант (первые значения enum) и обязан получить не-ошибку.
const LINK_DEFS = {
  adr: {
    rels: ['sprint', 'release', 'component', 'depends_on', 'supersedes', 'tag', 'project'],
    replaces: ['adr_link'],
    dispatch: (id, rel, t, action, f): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      switch (rel) {
        case 'sprint': return { path: '/lore/adr/link', body: { adr_id: id, sprint_id: t, action: action ?? 'add' } };
        case 'release': return { path: '/lore/adr/link', body: { adr_id: id, release_id: t, git_project: f.git_project ?? null, action: action ?? 'add' } };
        case 'component': return { path: '/lore/adr/component', body: { adr_id: id, component_id: t, action: action ?? 'add' } };
        case 'depends_on': return { path: '/lore/adr/depends_on', body: { adr_id: id, dep_adr_id: t, action: action ?? 'add' } };
        case 'supersedes': return { path: '/lore/adr/supersedes', body: { adr_id: id, superseded_adr_id: t, action: action ?? 'add' } };
        case 'tag': return { path: '/lore/adr/tag', body: { adr_id: id, tag_id: t, action: action ?? 'add' } };
        case 'project': return { path: '/lore/adr/project', body: { adr_id: id, project: t, action: action ?? 'add' } };
      }
      return `unreachable: adr/${rel}`;
    },
  },
  actor: {
    rels: ['fills_role'],
    replaces: ['actor_link'],
    dispatch: (id, rel, t, action): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      return { path: '/lore/actor/link', body: { actor_id: id, rel, target_id: t, action: action ?? 'add' } };
    },
  },
  bragi_keyword: {
    rels: ['rubric'],
    replaces: ['bragi_link'],
    dispatch: (id, rel, t, action): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      return { path: '/lore/bragi/rubric/link', body: { entity_type: 'keyword', entity_id: id, rubric_id: t, action: action ?? 'add' } };
    },
  },
  bragi_publication: {
    rels: ['rubric', 'produced_by', 'shipped_in'],
    replaces: ['bragi_link'],
    dispatch: (id, rel, t, action, f): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      if (rel === 'rubric') return { path: '/lore/bragi/rubric/link', body: { entity_type: 'publication', entity_id: id, rubric_id: t, action: action ?? 'add' } };
      return bragiForsetiLink('publication', id, rel, t, action ?? 'add', f);
    },
  },
  bragi_variant: {
    rels: ['rubric', 'produced_by', 'shipped_in'],
    replaces: ['bragi_link'],
    dispatch: (id, rel, t, action, f): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      if (rel === 'rubric') return { path: '/lore/bragi/rubric/link', body: { entity_type: 'variant', entity_id: id, rubric_id: t, action: action ?? 'add' } };
      return bragiForsetiLink('variant', id, rel, t, action ?? 'add', f);
    },
  },
  decision: {
    rels: ['component', 'project'],
    replaces: ['decision_link'],
    dispatch: (id, rel, t, action): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      if (rel === 'component') return { path: '/lore/decision/component', body: { decision_id: id, component_id: t, action: action ?? 'add' } };
      return { path: '/lore/decision/project', body: { decision_id: id, project: t, action: action ?? 'add' } };
    },
  },
  doc: {
    rels: ['parent', 'component', 'sprint', 'project'],
    replaces: ['doc_link'],
    dispatch: (id, rel, t, action): LinkResult | string => {
      if (rel === 'parent') return { path: '/lore/doc/parent', body: { doc_id: id, parent_doc_id: t ?? null, action: action ?? 'add' } };
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      if (rel === 'component') return { path: '/lore/doc/component', body: { doc_id: id, component_id: t, action: action ?? 'add' } };
      if (rel === 'project') return { path: '/lore/doc/project', body: { doc_id: id, project: t, action: action ?? 'add' } };
      return { path: '/lore/doc/sprint', body: { doc_id: id, sprint_id: t, action: action ?? 'add' } };
    },
  },
  feature: {
    rels: ['pain', 'gain', 'job', 'milestone', 'component', 'builds_on'],
    replaces: ['feature_link'],
    dispatch: (id, rel, t, action): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      return { path: '/lore/feature/link', body: { feature_id: id, rel, target_id: t, action: action ?? 'add' } };
    },
  },
  insight: {
    rels: ['task', 'adr'],
    replaces: ['insight_link'],
    dispatch: (id, rel, t, action): LinkResult | string => {
      if (action === 'remove') return 'type="insight" is add-only via /lore/bragi/insight/link (parity with insight_link — the endpoint takes no action)';
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      return { path: '/lore/bragi/insight/link', body: { insight_id: id, target_type: rel, target_id: t } };
    },
  },
  milestone: {
    rels: ['product'],
    replaces: ['milestone_link'],
    dispatch: (id, rel, t, action): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      return { path: '/lore/milestone/product', body: { milestone_id: id, product_code: t, action: action ?? 'add' } };
    },
  },
  product: {
    rels: ['component', 'project', 'parent', 'serves'],
    replaces: ['product_link'],
    dispatch: (id, rel, t, action, f): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      return { path: '/lore/product/link', body: { product_code: id, rel, target_id: t, role: f.role ?? null, action: action ?? 'add', kind: f.kind ?? null } };
    },
  },
  question: {
    rels: ['answers', 'raised_in', 'gates', 'component', 'project'],
    replaces: ['question_link'],
    dispatch: (id, rel, t, action, f): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      switch (rel) {
        case 'answers': return { path: '/lore/question/answers', body: { decision_id: t, question_id: id, action: action ?? 'add' } };
        case 'gates': return { path: '/lore/question/gates', body: { question_id: id, task_uid: t, action: action ?? 'add' } };
        case 'component': return { path: '/lore/question/component', body: { question_id: id, component_id: t, action: action ?? 'add' } };
        case 'project': return { path: '/lore/question/project', body: { question_id: id, project: t, action: action ?? 'add' } };
        case 'raised_in': {
          if (!f.target_type) return 'fields.target_type (adr|sprint|task) required for rel="raised_in"';
          return { path: '/lore/question/raised_in', body: { question_id: id, target_type: f.target_type, target_id: t, action: action ?? 'add' } };
        }
      }
      return `unreachable: question/${rel}`;
    },
  },
  release: {
    rels: ['sprint', 'pr'],
    replaces: ['release_link', 'release_unlink'],
    dispatch: (id, rel, t, action, f): LinkResult | string => {
      const ids = asIds(t);
      if (!ids.length) return `target_id required for rel="${rel}" — a sprint id / PR number or an array of them`;
      if (!str(f.git_project)) return 'fields.git_project is required for type="release" (multi-repo safety: release_uid = "{git_project}#{release_id}")';
      const git_project = str(f.git_project);
      if (action === 'remove') {
        return rel === 'sprint'
          ? { path: '/lore/release/unlink', body: { release_id: id, git_project, sprint_ids: ids, pr_numbers: [] } }
          : { path: '/lore/release/unlink', body: { release_id: id, git_project, sprint_ids: [], pr_numbers: ids } };
      }
      return rel === 'sprint'
        ? { path: '/lore/release/link', body: { release_id: id, sprint_ids: ids, pr_numbers: [], git_project } }
        : { path: '/lore/release/link', body: { release_id: id, sprint_ids: [], pr_numbers: ids, git_project } };
    },
  },
  runbook: {
    rels: ['adr', 'project'],
    replaces: ['runbook_link'],
    dispatch: (id, rel, t, action): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      return rel === 'project'
        ? { path: '/lore/runbook/project', body: { runbook_id: id, project: t, action: action ?? 'add' } }
        : { path: '/lore/runbook/adr', body: { runbook_id: id, adr_id: t, action: action ?? 'add' } };
    },
  },
  spec: {
    rels: ['component', 'project'],
    replaces: ['spec_link'],
    dispatch: (id, rel, t, action, f): LinkResult | string => {
      if (action !== undefined) return 'type="spec" is governed by fields.mode (add|remove|replace, default "replace" — parity with spec_link); drop action';
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      return { path: '/lore/spec/link', body: { spec_id: id, target_id: t, rel, mode: f.mode ?? 'replace' } };
    },
  },
  sprint: {
    rels: ['project', 'dep', 'component', 'milestone'],
    replaces: ['sprint_link'],
    dispatch: (id, rel, t, action, f): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      switch (rel) {
        case 'project': return { path: '/lore/sprint/project', body: { sprint_id: id, git_project: t, action: action ?? 'add' } };
        case 'dep': return { path: '/lore/sprint/dep', body: { from_sprint: id, to_sprint: t, kind: f.kind ?? 'soft', reason: f.reason ?? null, action: action ?? 'add' } };
        case 'component': return { path: '/lore/sprint/component', body: { sprint_id: id, component_id: t, action: action ?? 'add' } };
        case 'milestone': return { path: '/lore/milestone/sprint', body: { sprint_id: id, milestone_id: t, action: action ?? 'add' } };
      }
      return `unreachable: sprint/${rel}`;
    },
  },
  task: {
    rels: ['phase', 'component', 'file', 'adr', 'pr'],
    replaces: ['task_link'],
    dispatch: (id, rel, t, action, f): LinkResult | string => {
      switch (rel) {
        case 'phase': return { path: '/lore/task/phase', body: { task_uid: id, phase_uid: t ?? null, action: action ?? 'add' } };
        case 'file': {
          if (needTarget(t, rel)) return 'target_id (file path) required for rel="file"';
          if (!str(f.project)) return 'fields.project (KnowGitProject slug) required for rel="file"';
          return { path: '/lore/task/file', body: { task_uid: id, project: str(f.project), file_path: t, summary_md: f.summary_md ?? null, action: action ?? 'add' } };
        }
        case 'pr': {
          if (needTarget(t, rel)) return 'target_id required for rel="pr": "owner/repo#N", or "#N" with fields.project';
          return { path: '/lore/task/pr', body: { task_uid: id, pr: t, project: str(f.project) ?? ACTIVE_PROJECT ?? null, action: action ?? 'add' } };
        }
        case 'adr': {
          if (needTarget(t, rel)) return 'target_id (adr_id) required for rel="adr"';
          return { path: '/lore/task/adr', body: { task_uid: id, adr_id: t, action: action ?? 'add' } };
        }
        case 'component': {
          if (needTarget(t, rel)) return 'target_id required for rel="component"';
          return { path: '/lore/task/component', body: { task_uid: id, component_id: t, action: action ?? 'add' } };
        }
      }
      return `unreachable: task/${rel}`;
    },
  },
  uc: {
    rels: ['task', 'adr', 'decision', 'actor', 'component', 'project', 'includes', 'extends', 'relieves', 'delivers', 'performs'],
    replaces: ['uc_link'],
    dispatch: (id, rel, t, action, f): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      return { path: '/lore/uc/link', body: { uc_id: id, rel, target_id: t, action: action ?? 'add', actor_role: f.actor_role ?? null } };
    },
  },
  vp: {
    rels: ['felt_by', 'desired_by', 'performed_by', 'blocks', 'success_of'],
    replaces: ['vp_link'],
    dispatch: (id, rel, t, action): LinkResult | string => {
      if (needTarget(t, rel)) return needTarget(t, rel)!;
      return { path: '/lore/vp/link', body: { source_id: id, rel, target_id: t, action: action ?? 'add' } };
    },
  },
} satisfies Record<string, {
  rels: readonly string[];
  replaces: string[];
  dispatch: (id: string, rel: string, targetId: unknown, action: LinkAction, fields: Record<string, unknown>) => LinkResult | string;
}>;

type LinkType = keyof typeof LINK_DEFS;
const LINK_TYPES = Object.keys(LINK_DEFS) as [LinkType, ...LinkType[]];
const LINK_RELS = [
  'sprint', 'release', 'component', 'depends_on', 'supersedes', 'tag', 'project',
  'fills_role', 'rubric', 'produced_by', 'shipped_in', 'parent', 'file', 'pr', 'adr',
  'pain', 'gain', 'job', 'milestone', 'builds_on', 'product', 'task', 'decision',
  'actor', 'includes', 'extends', 'relieves', 'delivers', 'performs', 'answers',
  'raised_in', 'gates', 'dep', 'phase', 'felt_by', 'desired_by', 'performed_by',
  'blocks', 'success_of', 'serves',
] as const;

// ── entity_delete / entity_move ─────────────────────────────────────────────

const DELETE_DEFS = {
  adr: { idField: 'adr_id', path: '/lore/adr/delete', replaces: ['adr_del'] },
  spec: { idField: 'spec_id', path: '/lore/spec/delete', replaces: ['spec_del'] },
  doc: { idField: 'doc_id', path: '/lore/doc/delete', replaces: ['doc_del'] },
  component: { idField: 'component_id', path: '/lore/component/delete', replaces: ['component_del'] },
} satisfies Record<string, { idField: string; path: string; replaces: string[] }>;

const MOVE_DEFS = {
  task: {
    replaces: ['task_mv'],
    run: (id, target, f) => ({
      path: '/lore/task/move',
      body: { task_uid: id, target_sprint_id: target, new_task_id: f.new_task_id ?? null },
    }),
  },
  release: {
    replaces: ['release_mv'],
    run: (id, target) => ({ path: '/lore/project/move', body: { entity_type: 'release', id, git_project: target } }),
  },
  pr: {
    replaces: [],
    run: (id, target) => ({ path: '/lore/project/move', body: { entity_type: 'pr', id, git_project: target } }),
  },
} satisfies Record<string, {
  replaces: string[];
  run: (id: string, target: string, fields: Record<string, unknown>) => LinkResult;
}>;

// ── Список скрываемых по умолчанию старых имён (единый источник — таблицы выше) ─

export const LEGACY_CRUD_TOOLS: readonly string[] = [
  ...new Set([
    ...Object.values(UPSERT_DEFS).flatMap(d => d.replaces),
    ...Object.values(LINK_DEFS).flatMap(d => d.replaces),
    ...Object.values(DELETE_DEFS).flatMap(d => d.replaces),
    ...Object.values(MOVE_DEFS).flatMap(d => d.replaces),
  ]),
].sort();

/**
 * Композиция гейта поверхности с legacy-осью MCPV2-3 (см. шапку файла).
 * base — гейт профиля (profile.ts); режим решает, скрываются ли покрытые
 * старые именя ПОД базовым гейтом. Возвращает гейт для withStrictTools.
 */
export function legacySurfaceGate(
  base: (tool: string) => boolean,
  mode: { legacy: boolean; narrowed: boolean },
): (tool: string) => boolean {
  if (mode.legacy || mode.narrowed) return base;
  return (tool: string) => !LEGACY_CRUD_TOOLS.includes(tool) && base(tool);
}

// ── Регистрация ─────────────────────────────────────────────────────────────

const TYPE_ID_LIST = UPSERT_TYPES.map(t => `${t}→${upsertIdHint(t)}`).join(', ');

export function registerEntity(server: McpServer): void {
  server.tool(
    'entity_upsert',
    'Create or update any LORE entity through ONE generic call (SPRINT_LORE_MCP_V2/MCPV2-3 — ' +
      'consolidates the per-entity *_new/*_set tools; mcp-server/MIGRATION.md maps every replaced name). ' +
      '`type` picks the family, `id` carries its id field, `fields` is a free-form record validated by the ' +
      'BACKEND with the same payload shapes as the tools it replaces (unknown type values are rejected by the ' +
      'schema with the full list).\n\n' +
      'id per type: ' + TYPE_ID_LIST + '. Composite-id types (dict, phase, tech) take their id parts in fields ' +
      '(dict: dict_type+code; phase: sprint_id+phase_key; tech: component_id+tech_name+version) — omit id there; ' +
      'task takes the uid "SPRINT_X/T05".\n\n' +
      'Project guard (AL-113, parity with the old *_new orphan guard): for adr, doc, spec, runbook, question, ' +
      'uc, feature, tech a project is REQUIRED — pass fields.project or set LORE_ACTIVE_PROJECT; the ' +
      'BELONGS_TO_PROJECT edge is wired inline after the write. decision waives the guard when fields.adr_id is ' +
      'set (project arrives via the parent ADR). sprint maps fields.project/git_project → git_project with the ' +
      'session fallback; actor/project_actor carry project/projects as body fields.\n\n' +
      'dict: fields.human_approval ("who approved, where") travels as the X-Lore-Human-Approval header ' +
      '(human-only family), not the body. question: fields.status="closed" is refused with guidance — close via ' +
      'entity_link type=question rel=answers. Mutates the shared system_aida_lore.',
    {
      type: z.enum(UPSERT_TYPES).describe('entity family — the consolidated per-entity tool group to write through'),
      id: z.string().optional().describe('entity id (the family\'s id field, see the list in the description); omit for composite-id types (dict, phase, tech)'),
      fields: z.record(z.string(), z.unknown()).optional()
        .describe('free-form entity fields, validated by the backend — same payload shapes as the replaced per-entity tools'),
    },
    async ({ type, id, fields: rawFields }) => {
      const def: UpsertDef = UPSERT_DEFS[type as UpsertType];
      const fields = rec(rawFields);
      const project = str(fields.project);
      // Составной id (dict, phase, tech): id не принимается, части едут в fields.
      // task — особый случай: id обязателен (uid), но body собирается из частей.
      const composite = !def.idField && type !== 'task';
      if (composite && id !== undefined) {
        return err(new Error(`type="${type}" has a composite id — omit id and pass its parts in fields (${def.idHint})`));
      }
      if (!composite && id === undefined) {
        return err(new Error(`id is required for type="${type}" — ${def.idField ? `the ${def.idField} value` : 'the task uid "SPRINT_X/T05"'}`));
      }
      if (def.guardUnlessAdr ? !fields.adr_id && projectMissing(project) : def.guardProject && projectMissing(project)) {
        return projectRequired();
      }
      if (def.refuseClosed && fields.status === 'closed') {
        return { content: [{ type: 'text' as const, text: QUESTION_CLOSE_GUIDANCE }], isError: true };
      }
      const body = def.build ? def.build(id, fields) : { ...omit(fields, def.stripProject ? 'project' : ''), [def.idField!]: id };
      if (typeof body === 'string') return err(new Error(body));
      try {
        const headers = def.humanApproval && str(fields.human_approval)?.trim()
          ? { 'X-Lore-Human-Approval': encodeURIComponent(str(fields.human_approval)!.trim()) }
          : undefined;
        const res = headers ? await lorePost(def.path, body, headers) : await lorePost(def.path, body);
        const extra = def.after
          ? await def.after(id, fields, project)
          : def.project
            ? await inlineProject(def.project, id!, project)
            : {};
        return json({ ...(res as Record<string, unknown>), ...extra });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'entity_link',
    'Link (or unlink) any LORE entity through ONE generic call (MCPV2-3 — consolidates the eight ' +
      '*_link collapse tools plus vp/feature/uc/actor/decision/question/product/milestone/spec links and ' +
      'release_unlink). `type` picks the family, `rel` the edge; an unknown rel for the type is a 400 naming ' +
      'the rels valid for that type. `fields` carries rel-conditional extras exactly as the old tools did: ' +
      'git_project (adr/release, bragi shipped_in), kind+reason (sprint dep), project+summary_md (task file/pr), ' +
      'actor_role (uc actor), target_type (question raised_in, bragi produced_by), role+kind (product), ' +
      'mode (spec — add|remove|replace, default "replace"; action is NOT accepted for spec). ' +
      'target_id is a single id, or an array for type=release (the old release_link/release_unlink were batch). ' +
      'type=insight is add-only (parity with insight_link). Mutates system_aida_lore.',
    {
      type: z.enum(LINK_TYPES).describe('entity family whose link tool to route through'),
      id: z.string().describe('source entity id (adr_id, sprint_id, task_uid, source_id for vp, product_code, …)'),
      rel: z.enum(LINK_RELS).describe('edge type — valid values depend on type; an unknown pair is a 400 with the type\'s list'),
      target_id: z.union([z.string(), z.number().int(), z.array(z.union([z.string(), z.number().int()]))]).optional()
        .describe('target id (single, or array for type=release); omit only where the old tool allowed it (task phase remove, doc parent remove)'),
      action: z.enum(['add', 'remove']).optional().describe('default "add"; not accepted for type=spec (use fields.mode)'),
      fields: z.record(z.string(), z.unknown()).optional().describe('rel-conditional extras (git_project, kind, reason, actor_role, target_type, mode, role, summary_md, project)'),
    },
    async ({ type, id, rel, target_id, action, fields: rawFields }) => {
      const def = LINK_DEFS[type as LinkType];
      const rels = def.rels as readonly string[];
      if (!rels.includes(rel)) {
        return err(new Error(`unknown rel "${rel}" for type="${type}" — valid rels: ${rels.join(', ')}`));
      }
      const out = def.dispatch(id, rel, target_id, action, rec(rawFields));
      if (typeof out === 'string') return err(new Error(out));
      try {
        return json(await lorePost(out.path, out.body));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'entity_delete',
    'PERMANENTLY delete a LORE entity (MCPV2-3 — consolidates adr_del, spec_del, doc_del, component_del). ' +
      'Irreversible: edges cascade first, then history rows, then the vertex. component is GUARDED — the ' +
      'backend refuses (409 with a breakdown) while children, BELONGS_TO edges, documented specs or flat ' +
      'component_id references remain. Prefer deprecating over deleting anything that was ever real. ' +
      'Mutates the shared system_aida_lore.',
    {
      type: z.enum(['adr', 'spec', 'doc', 'component']).describe('entity family to delete from'),
      id: z.string().describe('entity id (adr_id / spec_id / doc_id / component_id)'),
    },
    async ({ type, id }) => {
      const def = DELETE_DEFS[type as keyof typeof DELETE_DEFS];
      try {
        return json(await lorePost(def.path, { [def.idField]: id }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'entity_move',
    'Move a LORE entity (MCPV2-3 — consolidates task_mv and release_mv). type="task": move a task to ' +
      'another sprint (cancel + recreate — the source stays as a CANCELLED tombstone; target = destination ' +
      'sprint_id; fields.new_task_id optionally renames in the target). type="release" / "pr": correct a ' +
      'misattributed git_project (target = the correct project slug). Mutates the shared system_aida_lore.',
    {
      type: z.enum(['task', 'release', 'pr']).describe('task → another sprint; release/pr → another git_project'),
      id: z.string().describe('task: full task uid "SPRINT_OLD/T05"; release: release_id or release_uid; pr: pr_uid or bare number'),
      target: z.string().describe('task: destination sprint_id; release/pr: correct git_project slug'),
      fields: z.record(z.string(), z.unknown()).optional().describe('extras: new_task_id (type=task only)'),
    },
    async ({ type, id, target, fields: rawFields }) => {
      const def = MOVE_DEFS[type as keyof typeof MOVE_DEFS];
      const out = def.run(id, target, rec(rawFields));
      try {
        return json(await lorePost(out.path, out.body));
      } catch (e) {
        return err(e);
      }
    },
  );
}
