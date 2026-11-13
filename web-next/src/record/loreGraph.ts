// Граф паспорта на серверном GET /lore/graph (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04, клиентская
// часть; сервер — PR #1228). Владелица 11.11.2026: «попроси серверную версию сделать сервис
// для графа с супер запросами».
//
// Фасад /lore/record даёт только один шаг связей записи — глубина 2–3 вкладки «Граф» ничего
// не добавляла, а у соседей не было типа. /lore/graph отдаёт окрестность в обе стороны на
// глубину 1–3, с типом, названием и статусом каждого узла. Что граф НЕ показывает (края не
// прочитаны, скрыто правами, связи вне выдачи) — называется словами, а не молчанием.
import type { KitData, KitLang, KitMeta, KitRecord } from '@seidr/kit';
import { loreFetch } from '../auth/session';

export interface LoreGraphNode { id: string; type: string; title: string | null; status: string | null; status_category: string | null; depth: number }
export interface LoreGraphEdge { from: string; rel: string; to: string; kind?: string }
export interface LoreGraphMeta {
  mode?: string; depth?: number; complete: boolean; truncated: boolean; capped_at?: number | null; hidden_by_scope?: number;
  dangling?: { id: string; rel: string; dir: string; reason: string; count: number }[];
  frontier_edges?: string;
  /** Типы связей окрестности со счётом — без учёта фильтра rels (сервер с feat/graph-depth4). */
  rels_available?: { rel: string; count: number }[];
  /** Сколько узлов на каждом шаге от записи (без самой записи). */
  by_depth?: Record<string, number>;
  /** Эхо фильтра rels; потолок узлов; окрестность для rels_available обрезана потолком. */
  rels?: string[] | null; limit?: number; rels_available_truncated?: boolean;
}
export interface LoreGraphBody { nodes: LoreGraphNode[]; edges: LoreGraphEdge[]; meta: LoreGraphMeta }

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchLoreGraph(q: { type: string; id: string; depth: number; structural?: boolean; rels?: string[] }, fetchFn: FetchFn = loreFetch): Promise<LoreGraphBody> {
  const p = new URLSearchParams({ type: q.type, id: q.id, depth: String(q.depth) });
  if (q.structural) p.set('structural', 'true');
  // Владелица 11.11: «показать связи определённого типа» — обход идёт строго по выбранным типам.
  if (q.rels?.length) p.set('rels', q.rels.join(','));
  const res = await fetchFn(`/lore/graph?${p.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let code = '';
    try { const b = await res.json() as { error?: string; detail?: string }; code = [b.error, b.detail].filter(Boolean).join(': '); } catch { /* тело не JSON */ }
    throw new Error(`${res.status}${code ? ` ${code}` : ''}`);
  }
  return await res.json() as LoreGraphBody;
}

/**
 * Слить ответ графа с данными паспорта: недостающие записи — с типом, названием и статусом;
 * записи паспорта (у них поля) не перетираются; рёбра без дублей. Неполнота графа — truncated.
 */
export function mergeGraph(data: KitData, g: LoreGraphBody): KitData {
  const records = new Map<string, KitRecord>(data.records.map(r => [r.id, r]));
  for (const n of g.nodes) {
    if (records.has(n.id)) continue;
    records.set(n.id, { id: n.id, kind: n.type, title: n.title || n.id, status: n.status ?? '', fields: n.status_category ? { status_category: n.status_category } : {} });
  }
  const seen = new Set(data.edges.map(e => `${e.type}\u0000${e.from}\u0000${e.to}`));
  const edges = [...data.edges];
  for (const e of g.edges) {
    const k = `${e.rel}\u0000${e.from}\u0000${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ from: e.from, to: e.to, type: e.rel });
  }
  const meta: KitMeta = { ...data.meta, truncated: !!data.meta.truncated || !g.meta.complete || g.meta.truncated, graphRels: relsOf(g), graphDepth: depthsOf(g) };
  return { ...data, records: [...records.values()], edges, meta };
}

/** Типы связей окрестности: rels_available сервера; старый сервер — счёт по рёбрам ответа. */
export function relsOf(g: LoreGraphBody): { rel: string; count: number }[] {
  if (g.meta.rels_available?.length) return g.meta.rels_available;
  const m = new Map<string, number>();
  for (const e of g.edges) m.set(e.rel, (m.get(e.rel) ?? 0) + 1);
  return [...m].map(([rel, count]) => ({ rel, count })).sort((a, b) => b.count - a.count || a.rel.localeCompare(b.rel));
}

/** Шаг каждого узла от записи — для подсветки уровней. */
export function depthsOf(g: LoreGraphBody): Record<string, number> {
  return Object.fromEntries(g.nodes.map(n => [n.id, n.depth]));
}

const NOTES = {
  ru: {
    frontier: (d: number) => `Связи между узлами на краю (глубина ${d}) не показаны — так сервер держит запрос дешёвым`,
    hidden: (n: number) => `Скрыто правами: ${n}`,
    dangling: (n: number) => `Связи вне выдачи: ${n}`,
    capped: (n: number) => `Граф обрезан: показано не больше ${n} узлов`,
    levels: 'Уровни',
    pickRels: 'На глубине 4 граф упирается в потолок — снимите лишние типы связей в легенде',
    relsCut: 'Счёт типов связей — по обрезанной окрестности',
  },
  en: {
    frontier: (d: number) => `Links between edge nodes (depth ${d}) are not shown — this keeps the query cheap`,
    hidden: (n: number) => `Hidden by access: ${n}`,
    dangling: (n: number) => `Links outside the result: ${n}`,
    capped: (n: number) => `Graph cut: at most ${n} nodes shown`,
    levels: 'Levels',
    pickRels: 'At depth 4 the graph hits the cap — turn off extra link types in the legend',
    relsCut: 'Link type counts are from a cut neighbourhood',
  },
} as const;

/** Что граф не показывает — словами (пустой массив — показано всё). */
export function graphNotes(m: LoreGraphMeta, lang: KitLang): string[] {
  const t = NOTES[lang === 'en' ? 'en' : 'ru'];
  const out: string[] = [];
  if (m.frontier_edges === 'not_read') out.push(t.frontier(m.depth ?? 1));
  if ((m.hidden_by_scope ?? 0) > 0) out.push(t.hidden(m.hidden_by_scope!));
  const dangling = (m.dangling ?? []).reduce((n, d) => n + (d.count || 0), 0);
  if (dangling > 0) out.push(t.dangling(dangling));
  if (m.truncated && m.capped_at) out.push(t.capped(m.capped_at));
  // Сервер (feat/graph-depth4): на 4 без фильтра ответ почти всегда упирается в потолок —
  // подсказка выбрать типы, а не молча обрезанный граф.
  if (m.truncated && (m.depth ?? 1) >= 4 && !m.rels?.length) out.push(t.pickRels);
  if (m.rels_available_truncated) out.push(t.relsCut);
  const levels = Object.entries(m.by_depth ?? {}).sort(([a], [b]) => Number(a) - Number(b));
  if (levels.length) out.push(`${t.levels}: ${levels.map(([d, n]) => `${d} — ${n}`).join(' · ')}`);
  return out;
}

/**
 * Типы узлов графа: подпись и цвет-токен темы. Цвет типа в модели сервера — класс web-next
 * (section-*), а не токен kit, поэтому палитра графа — здесь, токенами.
 */
const TONE: Record<string, string> = {
  sprint: '--inf', task: '--t2', adr: '--suc', spec: '--wrn', decision: '--acc', question: '--wrn',
  release: '--dng', milestone: '--acc', component: '--acc', project: '--t1', use_case: '--inf', feature: '--suc', doc: '--t2', runbook: '--t3',
};
const LABEL: Record<'ru' | 'en', Record<string, string>> = {
  ru: { sprint: 'Спринт', task: 'Задача', adr: 'ADR', spec: 'Спека', decision: 'Решение', question: 'Вопрос', release: 'Релиз', milestone: 'Веха', component: 'Компонент', project: 'Проект', use_case: 'Сценарий', feature: 'Фича', doc: 'Документ', runbook: 'Ранбук' },
  en: { sprint: 'Sprint', task: 'Task', adr: 'ADR', spec: 'Spec', decision: 'Decision', question: 'Question', release: 'Release', milestone: 'Milestone', component: 'Component', project: 'Project', use_case: 'Use case', feature: 'Feature', doc: 'Doc', runbook: 'Runbook' },
};
/** PU-11: формы слова «N чего» — подпись кластера-хаба в графе («27 спек ▸»). */
type CountForms = { one: string; few?: string; many: string };
const COUNT: Record<'ru' | 'en', Record<string, CountForms>> = {
  ru: {sprint: {one: "{n} спринт", few: "{n} спринта", many: "{n} спринтов"}, task: {one: "{n} задача", few: "{n} задачи", many: "{n} задач"}, adr: {one: "{n} ADR", few: "{n} ADR", many: "{n} ADR"}, spec: {one: "{n} спека", few: "{n} спеки", many: "{n} спек"}, decision: {one: "{n} решение", few: "{n} решения", many: "{n} решений"}, question: {one: "{n} вопрос", few: "{n} вопроса", many: "{n} вопросов"}, release: {one: "{n} релиз", few: "{n} релиза", many: "{n} релизов"}, milestone: {one: "{n} веха", few: "{n} вехи", many: "{n} вех"}, component: {one: "{n} компонент", few: "{n} компонента", many: "{n} компонентов"}, project: {one: "{n} проект", few: "{n} проекта", many: "{n} проектов"}, use_case: {one: "{n} сценарий", few: "{n} сценария", many: "{n} сценариев"}, feature: {one: "{n} фича", few: "{n} фичи", many: "{n} фич"}, doc: {one: "{n} документ", few: "{n} документа", many: "{n} документов"}, runbook: {one: "{n} ранбук", few: "{n} ранбука", many: "{n} ранбуков"}},
  en: {sprint: {one: "{n} sprint", many: "{n} sprints"}, task: {one: "{n} task", many: "{n} tasks"}, adr: {one: "{n} ADR", many: "{n} ADRs"}, spec: {one: "{n} spec", many: "{n} specs"}, decision: {one: "{n} decision", many: "{n} decisions"}, question: {one: "{n} question", many: "{n} questions"}, release: {one: "{n} release", many: "{n} releases"}, milestone: {one: "{n} milestone", many: "{n} milestones"}, component: {one: "{n} component", many: "{n} components"}, project: {one: "{n} project", many: "{n} projects"}, use_case: {one: "{n} use case", many: "{n} use cases"}, feature: {one: "{n} feature", many: "{n} features"}, doc: {one: "{n} doc", many: "{n} docs"}, runbook: {one: "{n} runbook", many: "{n} runbooks"}},
};

export function LORE_GRAPH_TYPES(lang: KitLang): Record<string, { label: string; color: string; count?: CountForms }> {
  const k = lang === 'en' ? 'en' : 'ru';
  const l = LABEL[k];
  return Object.fromEntries(Object.entries(TONE).map(([t, c]) => [t, { label: l[t] ?? t, color: c, count: COUNT[k][t] }]));
}
