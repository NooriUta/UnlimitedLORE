// Локальный граф паспорта на обратных связях S2 (SPRINT_UXR_S5_RECORD_TASKS/S5-10).
//
// Источник — GET /lore/backlinks (S2-02, контракт 1 SPEC-LORE-UXR-S2-CONTRACTS):
// один вызов отдаёт входящие связи одной записи, сгруппированные по типу ребра.
// Граф глубины 1–3 собирается обходом в ширину: цель → кто на неё ссылается →
// кто ссылается на них… Каждая запись спрашивается один раз, общий потолок
// вызовов (maxCalls) не даёт хабу разнести сеть. Результат — KitData для
// вкладки «Граф» kit (RecordGraph): records + edges + meta.
//
// Две формы. BacklinksResponse ниже — внутренняя форма, по которой собирается
// граф (родом из заглушки контракта S2). Живой сервер отвечает иначе
// (ServerBacklinksBody: edge/count/ref_id/complete), и fetchBacklinksHttp
// переводит его ответ во внутреннюю форму через fromServerBacklinks. До 11.11.2026
// перевода не было — тело читалось как заглушка, и у узлов коды были undefined
// (дефект P0 S5-10, сверено по LoreSearchResource.backlinks).
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
 * Ответ GET /lore/backlinks в той форме, в какой его отдаёт сервер
 * (`LoreSearchResource.backlinks`, сверено по коду 11.11.2026). Все связи —
 * входящие: поля direction у сервера нет.
 */
export interface ServerBacklinkItem { type: string | null; ref_id: string | null; title: string | null; source_class?: string }
export interface ServerBacklinkGroup { edge: string; count: number; truncated: boolean; items: ServerBacklinkItem[] }
export interface ServerBacklinksBody {
  type: string; id: string; title: string | null; total: number;
  groups: ServerBacklinkGroup[];
  hidden_by_scope?: number;
  excluded_edges?: string[];
  complete: boolean;
  unread_sources?: number;
  capped_at?: number;
  warnings?: unknown[];
}

/**
 * Перевод ответа сервера в форму, по которой собирается граф (S5-10, дефект P0).
 *
 * Раньше тело читалось как будто в форме заглушки S2 — `edge_type`, `items[].id`,
 * `completeness` — и на живом сервере у всех узлов коды были undefined, а тип
 * ребра терялся: граф строился по мусору. Неполнота называется, а не прячется:
 * `complete:false`, скрытые скоупом и источники без кода дают `partial`.
 */
export function fromServerBacklinks(b: ServerBacklinksBody): BacklinksResponse {
  let dropped = 0;
  const groups: BacklinkGroup[] = (b.groups ?? []).map(g => {
    const items: BacklinkItem[] = [];
    for (const it of g.items ?? []) {
      // Источник неизвестного серверу класса приходит без кода и типа: узлом его
      // не нарисовать, но и молча выкинуть нельзя — граф помечается неполным.
      if (!it.ref_id || !it.type) { dropped++; continue; }
      items.push({ type: it.type, id: it.ref_id, title: it.title, status: null, status_category: null, linked_at: null });
    }
    return { edge_type: g.edge, direction: 'in', total: g.count, truncated: !!g.truncated, items };
  });
  const partial = b.complete === false || (b.hidden_by_scope ?? 0) > 0 || (b.unread_sources ?? 0) > 0 || dropped > 0;
  const warnings: string[] = [];
  if ((b.hidden_by_scope ?? 0) > 0) warnings.push(`hidden_by_scope: ${b.hidden_by_scope}`);
  if (dropped > 0) warnings.push(`sources_without_code: ${dropped}`);
  return {
    target: { type: b.type, id: b.id, title: b.title ?? null },
    groups,
    total: b.total ?? groups.reduce((n, g) => n + g.total, 0),
    excluded_edge_types: b.excluded_edges ?? [],
    scope: null,
    outside_scope: null,
    completeness: partial ? 'partial' : 'complete',
    warnings,
  };
}

/**
 * GET /lore/backlinks. Токен и базовый адрес — забота fetchFn (обёртка
 * авторизации приложения); не-2xx — ошибка «код ERROR: detail» (цель вне
 * скоупа — 403 OUTSIDE_SCOPE, граф показывает её ошибкой блока, а не «связей нет»).
 * Сервер знает только `limit` — потолок элементов в группе.
 */
export function fetchBacklinksHttp(fetchFn: (url: string, init?: RequestInit) => Promise<Response> = loreFetch): BacklinksFetcher {
  return async q => {
    const p = new URLSearchParams({ type: q.type, id: q.id });
    if (q.per_edge != null) p.set('limit', String(q.per_edge));
    const res = await fetchFn(`/lore/backlinks?${p.toString()}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      let code = '';
      try { const b = await res.json() as { error?: string; detail?: string }; code = [b.error, b.detail].filter(Boolean).join(': '); } catch { /* тело не JSON */ }
      throw new Error(`${res.status}${code ? ` ${code}` : ''}`);
    }
    return fromServerBacklinks(await res.json() as ServerBacklinksBody);
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
