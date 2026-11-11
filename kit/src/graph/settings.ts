// Граф знаний kit (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-03): данные, настройки панели
// и физика — чистыми функциями, без React и без движков отрисовки.
//
// Владелица 11.11.2026: «даём выбирать пользователям вид граф и левое меню с
// настройками возьми у обсидиан», «бери пока из обсидиан». Поэтому разделы и
// значения по умолчанию — как в панели графа Обсидиана: Фильтры, Группы,
// Отображение, Силы. kit не знает предметных слов (K-14): типы узлов и связей,
// их подписи и цвета называет приложение.

/** Узел: код, тип (ключ в `types`), подпись. */
export interface GxNode { id: string; type: string; title?: string }
/** Ребро «откуда → куда», тип связи и необязательный вид (hard, soft…). */
export interface GxEdge { from: string; to: string; rel: string; kind?: string }
/** Как показать тип узла или связи: подпись словом и цвет (токен или CSS). */
export interface GxStyle { label: string; color?: string }

/** Движок: Force — d3-force на Canvas; Обсидиан — d3-force в воркере, WebGL. */
export type GxEngine = 'force' | 'obsidian';
export const GX_ENGINES: readonly GxEngine[] = ['force', 'obsidian'];

/** Группа: узлы, подходящие под запрос, красятся в цвет группы. */
export interface GxGroup { query: string; color: string }

export interface GxSettings {
  /** Фильтры. Поиск по коду и названию; скрытые типы; показывать ли сирот. */
  search: string;
  hiddenTypes: string[];
  orphans: boolean;
  /** Группы — первая подошедшая красит узел. */
  groups: GxGroup[];
  /** Отображение. */
  arrows: boolean;
  /** Порог подписей 0…1: 0 — подписи всегда, 1 — только при сильном приближении. */
  labels: number;
  nodeSize: number;
  linkWidth: number;
  /** Силы — шкалы как в Обсидиане. */
  center: number;
  repel: number;
  linkForce: number;
  linkDistance: number;
}

/** Значения по умолчанию — как у Обсидиана (сила центра ~0.5, отталкивание 10, длина связи 250). */
export const GX_DEFAULTS: GxSettings = Object.freeze({
  search: '', hiddenTypes: [], orphans: true, groups: [],
  arrows: false, labels: 0.5, nodeSize: 1, linkWidth: 1,
  center: 0.5, repel: 10, linkForce: 1, linkDistance: 250,
}) as GxSettings;

/** Пределы ползунков — они же нормализуют пришедшее из хранилища. */
export const GX_RANGES = {
  labels: [0, 1, 0.05], nodeSize: [0.2, 3, 0.1], linkWidth: [0.2, 3, 0.1],
  center: [0, 1, 0.01], repel: [0, 20, 0.5], linkForce: [0, 1, 0.01], linkDistance: [30, 500, 10],
} as const satisfies Record<string, readonly [number, number, number]>;

/** Палитра групп — токены темы, а не сырые цвета. */
export const GX_GROUP_COLORS = ['--acc', '--inf', '--suc', '--wrn', '--dng', '--t2'] as const;

const clamp = (v: unknown, [lo, hi]: readonly [number, number, number], fb: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;

/**
 * Настройки из чужих рук (хранилище браузера, приложение) — к годному виду.
 * Битое значение заменяется значением по умолчанию, а не роняет граф.
 */
export function normalizeGx(raw: unknown): GxSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof GxSettings, unknown>>;
  const d = GX_DEFAULTS;
  return {
    search: typeof r.search === 'string' ? r.search : d.search,
    hiddenTypes: Array.isArray(r.hiddenTypes) ? r.hiddenTypes.filter((t): t is string => typeof t === 'string') : [],
    orphans: typeof r.orphans === 'boolean' ? r.orphans : d.orphans,
    groups: Array.isArray(r.groups)
      ? r.groups.filter((g): g is GxGroup => !!g && typeof g === 'object'
          && typeof (g as GxGroup).query === 'string' && typeof (g as GxGroup).color === 'string')
      : [],
    arrows: typeof r.arrows === 'boolean' ? r.arrows : d.arrows,
    labels: clamp(r.labels, GX_RANGES.labels, d.labels),
    nodeSize: clamp(r.nodeSize, GX_RANGES.nodeSize, d.nodeSize),
    linkWidth: clamp(r.linkWidth, GX_RANGES.linkWidth, d.linkWidth),
    center: clamp(r.center, GX_RANGES.center, d.center),
    repel: clamp(r.repel, GX_RANGES.repel, d.repel),
    linkForce: clamp(r.linkForce, GX_RANGES.linkForce, d.linkForce),
    linkDistance: clamp(r.linkDistance, GX_RANGES.linkDistance, d.linkDistance),
  };
}

/** Подходит ли узел под запрос: «type:ключ» — по типу, иначе — подстрока кода или названия. */
export function gxMatches(n: GxNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (q.startsWith('type:')) return n.type.toLowerCase() === q.slice(5).trim();
  return n.id.toLowerCase().includes(q) || (n.title ?? '').toLowerCase().includes(q);
}

/** Цвет группы для узла или null — тогда цвет типа. */
export function gxGroupColor(n: GxNode, groups: readonly GxGroup[]): string | null {
  for (const g of groups) if (gxMatches(n, g.query)) return g.color;
  return null;
}

export interface GxFiltered {
  nodes: GxNode[];
  edges: GxEdge[];
  /** Сколько узлов было до фильтров — чтобы сказать «показано N из M». */
  total: number;
}

/**
 * Фильтры панели. Ребро живёт, только если живы оба конца; сироты убираются
 * ПОСЛЕ остальных фильтров — сиротой узел может стать именно из-за них.
 * Порядок узлов и рёбер на выходе — как на входе.
 */
export function gxFilter(nodes: readonly GxNode[], edges: readonly GxEdge[], s: GxSettings): GxFiltered {
  const hidden = new Set(s.hiddenTypes);
  const q = s.search.trim();
  let keep = new Set(nodes.filter(n => !hidden.has(n.type) && (!q || gxMatches(n, q))).map(n => n.id));
  const kept = edges.filter(e => keep.has(e.from) && keep.has(e.to));
  if (!s.orphans) {
    const linked = new Set<string>();
    for (const e of kept) { linked.add(e.from); linked.add(e.to); }
    keep = new Set([...keep].filter(id => linked.has(id)));
  }
  return { nodes: nodes.filter(n => keep.has(n.id)), edges: kept, total: nodes.length };
}

/** Счёт узлов по типу — для чекбоксов типов в панели. */
export function gxTypeCounts(nodes: readonly GxNode[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of nodes) m.set(n.type, (m.get(n.type) ?? 0) + 1);
  return m;
}

/**
 * Шкалы панели → параметры d3-force. Одна функция на оба движка: владелица
 * сравнивает их по поведению, и разные физики сделали бы сравнение нечестным.
 * При значениях по умолчанию получаются значения d3 по умолчанию (как у
 * force-graph): заряд −30, длина связи 30, сила связи — штатная.
 */
export interface GxForces { charge: number; distance: number; linkMul: number; pull: number }
export function gxForces(s: Pick<GxSettings, 'center' | 'repel' | 'linkForce' | 'linkDistance'>): GxForces {
  return {
    charge: -3 * s.repel,
    distance: s.linkDistance * 0.12,
    linkMul: s.linkForce,
    pull: s.center * 0.02,
  };
}

/** Ключ хранилища браузера для настроек панели одного места показа. */
export const GX_STORAGE_PREFIX = 'sk.graph.';

export function loadGx(key: string): GxSettings {
  try {
    const raw = globalThis.localStorage?.getItem(GX_STORAGE_PREFIX + key);
    return raw ? normalizeGx(JSON.parse(raw)) : { ...GX_DEFAULTS };
  } catch {
    return { ...GX_DEFAULTS };
  }
}

export function saveGx(key: string, s: GxSettings): void {
  try { globalThis.localStorage?.setItem(GX_STORAGE_PREFIX + key, JSON.stringify(s)); } catch { /* хранилище закрыто — настройки живут до перезагрузки */ }
}
