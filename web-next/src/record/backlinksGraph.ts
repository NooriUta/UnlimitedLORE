// Локальный граф паспорта на обратных связях S2 (SPRINT_UXR_S5_RECORD_TASKS/S5-10).
//
// Источник — GET /lore/backlinks (S2-02, контракт 1 SPEC-LORE-UXR-S2-CONTRACTS):
// один вызов отдаёт входящие связи одной записи, сгруппированные по типу ребра.
// Граф глубины 1–3 собирается обходом в ширину: цель → кто на неё ссылается →
// кто ссылается на них… Каждая запись спрашивается один раз, общий потолок
// вызовов (maxCalls) не даёт хабу разнести сеть. Результат — KitData для
// вкладки «Граф» kit (RecordGraph): records + edges + meta.
//
// ЗАГЛУШКА ПО КОНТРАКТУ. На origin/develop эндпоинта ещё нет (S2 в батч-ветке
// feature/fleet-batch-sprint_uxr_s2_graph_memory-*), а web-next/src/api/
// contracts/s2.ts — там же. Формы ниже — дословное подмножество контракта S2
// (BacklinksQuery/BacklinksResponse); после слияния S2 импортировать типы и
// BACKLINK_TARGET_TYPES из '../api/contracts/s2', а createBacklinksStub
// заменить на createS2Stub().backlinks.
//
// Честные состояния: цель вне скоупа и упавший вызов на цели — ошибка блока
// 'edges' (kit рисует LoadError, а не «связей нет»); обрезка per_edge,
// completeness=partial, потолок вызовов или упавший сосед глубже — meta.truncated.
import type { KitData, KitEdge, KitRecord } from '@seidr/kit';
import { loreFetch } from '../auth/session';

// ── Подмножество контракта S2 (s2.ts, контракт 1) ───────────────────────────

/** = BACKLINK_TARGET_TYPES S2: типы, для которых /lore/backlinks принимает type. */
export const BACKLINK_TARGET_TYPES = [
  'adr', 'spec', 'sprint', 'task', 'decision', 'question', 'runbook', 'doc',
  'quality_gate', 'use_case', 'pain', 'gain', 'job', 'actor', 'release', 'agent_actor',
] as const;
const TARGETS: ReadonlySet<string> = new Set(BACKLINK_TARGET_TYPES);

export interface EntityRef { type: string; id: string; title: string | null }
export interface BacklinksQuery { type: string; id: string; per_edge?: number; edge_types?: string }
export interface BacklinkItem extends EntityRef { status: string | null; status_category: string | null; linked_at: string | null }
export interface BacklinkGroup { edge_type: string; direction: 'in' | 'out'; total: number; truncated: boolean; items: BacklinkItem[] }
export interface BacklinksResponse {
  target: EntityRef;
  groups: BacklinkGroup[];
  total: number;
  excluded_edge_types: string[];
  scope: { applied: boolean; projects?: number; note?: string } | null;
  outside_scope: { id: string; verdict: 'outside_scope'; reason: string } | null;
  completeness: 'complete' | 'partial' | 'unknown';
  warnings: string[];
}

export type BacklinksFetcher = (q: BacklinksQuery) => Promise<BacklinksResponse>;

// ── Сбор графа ──────────────────────────────────────────────────────────────

export interface LoadGraphOptions {
  depth: 1 | 2 | 3;
  /** Потолок элементов в группе (контракт: по умолчанию 20, максимум 200). */
  perEdge?: number;
  /** Общий потолок вызовов backlinks на один граф. */
  maxCalls?: number;
  /** Время сборки для meta.generated_at (детерминизм тестов). */
  now?: () => string;
}

const DEFAULT_PER_EDGE = 20;
const DEFAULT_MAX_CALLS = 40;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function toRecord(ref: EntityRef & { status?: string | null; status_category?: string | null }): KitRecord {
  return {
    id: ref.id,
    kind: ref.type,
    title: ref.title ?? ref.id,
    status: ref.status ?? '',
    fields: ref.status_category ? { status_category: ref.status_category } : {},
  };
}

export async function loadBacklinksGraph(
  fetchBacklinks: BacklinksFetcher,
  root: { type: string; id: string; title?: string | null },
  opts: LoadGraphOptions,
): Promise<KitData> {
  const perEdge = opts.perEdge ?? DEFAULT_PER_EDGE;
  const maxCalls = Math.max(1, opts.maxCalls ?? DEFAULT_MAX_CALLS);
  const records = new Map<string, KitRecord>([[root.id, toRecord({ type: root.type, id: root.id, title: root.title ?? null })]]);
  const edges = new Map<string, KitEdge>();
  const errors: { block: string; reason: string }[] = [];
  let truncated = false;
  let calls = 0;
  const seen = new Set<string>([`${root.type}:${root.id}`]);
  let frontier: EntityRef[] = [{ type: root.type, id: root.id, title: root.title ?? null }];

  for (let d = 1; d <= opts.depth && frontier.length; d++) {
    const ask = frontier.filter(r => TARGETS.has(r.type));
    const budget = Math.max(0, maxCalls - calls);
    if (ask.length > budget) truncated = true;
    const batch = ask.slice(0, budget);
    calls += batch.length;
    const results = await Promise.allSettled(batch.map(r => fetchBacklinks({ type: r.type, id: r.id, per_edge: perEdge })));
    const next: EntityRef[] = [];
    results.forEach((res, i) => {
      const at = batch[i];
      if (res.status === 'rejected') {
        if (d === 1) errors.push({ block: 'edges', reason: errText(res.reason) });
        else { truncated = true; errors.push({ block: 'graph', reason: `${at.type}:${at.id}: ${errText(res.reason)}` }); }
        return;
      }
      const body = res.value;
      if (body.outside_scope) {
        if (d === 1) errors.push({ block: 'edges', reason: `outside_scope: ${body.outside_scope.reason}` });
        else truncated = true;
        return;
      }
      if (d === 1 && body.target?.title) records.set(root.id, { ...records.get(root.id)!, title: body.target.title });
      if (body.completeness === 'partial') truncated = true;
      for (const g of body.groups) {
        if (g.truncated) truncated = true;
        for (const it of g.items) {
          const e: KitEdge = g.direction === 'out'
            ? { from: at.id, to: it.id, type: g.edge_type }
            : { from: it.id, to: at.id, type: g.edge_type };
          edges.set(`${e.type}\u0000${e.from}\u0000${e.to}`, e);
          if (!records.has(it.id)) records.set(it.id, toRecord(it));
          const key = `${it.type}:${it.id}`;
          if (!seen.has(key)) { seen.add(key); next.push(it); }
        }
      }
    });
    frontier = next;
  }

  return {
    records: [...records.values()],
    edges: [...edges.values()].sort((a, b) => cmp(a.type, b.type) || cmp(a.from, b.from) || cmp(a.to, b.to)),
    journal: [],
    meta: {
      generated_at: opts.now ? opts.now() : new Date().toISOString(),
      returned: edges.size,
      truncated,
      ...(errors.length ? { errors } : {}),
    },
  };
}

// ── Транспорт ───────────────────────────────────────────────────────────────

/**
 * GET /lore/backlinks по контракту S2. Токен и базовый адрес — забота fetchFn
 * (обёртка авторизации приложения); не-2xx — ошибка «код ERROR: detail».
 */
export function fetchBacklinksHttp(fetchFn: (url: string, init?: RequestInit) => Promise<Response> = loreFetch): BacklinksFetcher {
  return async q => {
    const p = new URLSearchParams({ type: q.type, id: q.id });
    if (q.per_edge != null) p.set('per_edge', String(q.per_edge));
    if (q.edge_types) p.set('edge_types', q.edge_types);
    const res = await fetchFn(`/lore/backlinks?${p.toString()}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      let code = '';
      try { const b = await res.json() as { error?: string; detail?: string }; code = [b.error, b.detail].filter(Boolean).join(': '); } catch { /* тело не JSON */ }
      throw new Error(`${res.status}${code ? ` ${code}` : ''}`);
    }
    return await res.json() as BacklinksResponse;
  };
}

/** Заглушка контракта: ответы по ключу «type:id»; нет ключа — запись без входящих связей. */
export function createBacklinksStub(fixtures: Record<string, BacklinksResponse>): BacklinksFetcher {
  return async q => {
    const hit = fixtures[`${q.type}:${q.id}`];
    if (hit) return structuredClone(hit);
    return {
      target: { type: q.type, id: q.id, title: null }, groups: [], total: 0,
      excluded_edge_types: ['HAS_STATE', 'BELONGS_TO_PROJECT'], scope: null, outside_scope: null,
      completeness: 'complete', warnings: [],
    };
  };
}
