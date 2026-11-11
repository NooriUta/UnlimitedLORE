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
}
export interface LoreGraphBody { nodes: LoreGraphNode[]; edges: LoreGraphEdge[]; meta: LoreGraphMeta }

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchLoreGraph(q: { type: string; id: string; depth: number; structural?: boolean }, fetchFn: FetchFn = loreFetch): Promise<LoreGraphBody> {
  const p = new URLSearchParams({ type: q.type, id: q.id, depth: String(q.depth) });
  if (q.structural) p.set('structural', 'true');
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
  const meta: KitMeta = { ...data.meta, truncated: !!data.meta.truncated || !g.meta.complete || g.meta.truncated };
  return { ...data, records: [...records.values()], edges, meta };
}

const NOTES = {
  ru: {
    frontier: (d: number) => `Связи между узлами на краю (глубина ${d}) не показаны — так сервер держит запрос дешёвым`,
    hidden: (n: number) => `Скрыто правами: ${n}`,
    dangling: (n: number) => `Связи вне выдачи: ${n}`,
    capped: (n: number) => `Граф обрезан: показано не больше ${n} узлов`,
  },
  en: {
    frontier: (d: number) => `Links between edge nodes (depth ${d}) are not shown — this keeps the query cheap`,
    hidden: (n: number) => `Hidden by access: ${n}`,
    dangling: (n: number) => `Links outside the result: ${n}`,
    capped: (n: number) => `Graph cut: at most ${n} nodes shown`,
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
export function LORE_GRAPH_TYPES(lang: KitLang): Record<string, { label: string; color: string }> {
  const l = LABEL[lang === 'en' ? 'en' : 'ru'];
  return Object.fromEntries(Object.entries(TONE).map(([t, c]) => [t, { label: l[t] ?? t, color: c }]));
}
