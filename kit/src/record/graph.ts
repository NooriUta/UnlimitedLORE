// Локальный граф записи (SPRINT_UXR_S10_SEIDR_KIT/K-04): ego в центре, соседи
// по секторам — один сектор на тип ребра, через которое сосед связан с центром
// (сосед соседа наследует сектор первого шага). Данные — X_DATA.edges, без
// сервера. Чистая функция и детерминирована: порядок рёбер на входе не влияет
// на выход (сортировка по типу и id, координаты округлены).
import type { KitConfig, KitData, KitEdge, KitRecord, KitVerdict } from '../core/contract';

export interface EgoNode {
  id: string;
  /** Шаг от центра: 1..depth. */
  depth: number;
  /** Тип ребра первого шага — сектор узла. */
  sector: string;
  /** Направление ребра первого шага относительно центра. */
  dir: 'out' | 'in';
  /** Запись из выборки; нет — узел вне выборки (ссылка есть, записи нет). */
  record?: KitRecord;
  /** Угол (радианы) и координаты в единицах радиуса шага. */
  angle: number;
  x: number;
  y: number;
}

export interface EgoSector { type: string; start: number; end: number; count: number }

export interface EgoGraph {
  center: { id: string; record?: KitRecord };
  nodes: EgoNode[];
  links: KitEdge[];
  sectors: EgoSector[];
  /** Сколько узлов достижимо в пределах глубины (до лимита). */
  total: number;
  truncated: boolean;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const edgeKey = (e: KitEdge) => `${e.type}\u0000${e.from}\u0000${e.to}`;

export function egoGraph(centerId: string, data: KitData, opts: { depth: number; limit: number }): EgoGraph {
  const byId = new Map(data.records.map(r => [r.id, r] as const));
  const edges = [...data.edges].filter(e => e.from !== e.to).sort((a, b) => cmp(edgeKey(a), edgeKey(b)));
  const adj = new Map<string, { other: string; edge: KitEdge }[]>();
  const add = (k: string, v: { other: string; edge: KitEdge }) => {
    const list = adj.get(k);
    if (list) list.push(v); else adj.set(k, [v]);
  };
  for (const e of edges) {
    add(e.from, { other: e.to, edge: e });
    add(e.to, { other: e.from, edge: e });
  }

  const seen = new Map<string, Omit<EgoNode, 'angle' | 'x' | 'y'>>();
  let frontier: Omit<EgoNode, 'angle' | 'x' | 'y'>[] = [];
  for (const { other, edge } of adj.get(centerId) ?? []) {
    if (other === centerId || seen.has(other)) continue;
    const n = { id: other, depth: 1, sector: edge.type, dir: (edge.from === centerId ? 'out' : 'in') as 'out' | 'in', record: byId.get(other) };
    seen.set(other, n);
    frontier.push(n);
  }
  const order = (a: { sector: string; id: string }, b: { sector: string; id: string }) => cmp(a.sector, b.sector) || cmp(a.id, b.id);
  frontier.sort(order);
  const all = [...frontier];
  for (let d = 2; d <= opts.depth && frontier.length; d++) {
    const next: typeof frontier = [];
    for (const p of frontier) {
      for (const { other } of adj.get(p.id) ?? []) {
        if (other === centerId || seen.has(other)) continue;
        const n = { id: other, depth: d, sector: p.sector, dir: p.dir, record: byId.get(other) };
        seen.set(other, n);
        next.push(n);
      }
    }
    next.sort(order);
    all.push(...next);
    frontier = next;
  }

  const limit = Math.max(0, opts.limit);
  const shown = all.slice(0, limit);
  const types = [...new Set(shown.map(n => n.sector))].sort(cmp);
  const gap = types.length > 1 ? 0.08 : 0;
  const usable = Math.PI * 2 - gap * types.length;
  const sectors: EgoSector[] = [];
  let at = -Math.PI / 2;
  for (const type of types) {
    const count = shown.filter(n => n.sector === type).length;
    const span = (usable * count) / (shown.length || 1);
    sectors.push({ type, start: round(at), end: round(at + span), count });
    at += span + gap;
  }

  const nodes: EgoNode[] = [];
  for (const s of sectors) {
    const inSector = shown.filter(n => n.sector === s.type);
    for (let d = 1; d <= opts.depth; d++) {
      const ring = inSector.filter(n => n.depth === d);
      const step = (s.end - s.start) / (ring.length || 1);
      ring.forEach((n, i) => {
        const angle = round(s.start + step * (i + 0.5));
        nodes.push({ ...n, angle, x: round(Math.cos(angle) * d), y: round(Math.sin(angle) * d) });
      });
    }
  }

  const ids = new Set([centerId, ...shown.map(n => n.id)]);
  const links = edges.filter(e => ids.has(e.from) && ids.has(e.to));
  return {
    center: { id: centerId, record: byId.get(centerId) },
    nodes,
    links,
    sectors,
    total: all.length,
    truncated: all.length > shown.length,
  };
}

/**
 * Цвет из конфига → CSS. Конфиг пишет токен ('--acc' или 'acc'); незнакомый
 * токен темы (например --vio у пилота) не должен давать «прозрачный» узел —
 * фолбэк на нейтральный --t3. var(...) — как есть.
 */
export function toCssColor(c: string | undefined): string {
  const v = (c ?? '').trim();
  if (!v) return 'var(--t3)';
  if (v.startsWith('var(')) return v;
  if (v.startsWith('--')) return `var(${v}, var(--t3))`;
  if (/^[a-z][a-z0-9_-]*$/i.test(v)) return `var(--${v}, var(--t3))`;
  return v;
}

export function edgeColor(config: Pick<KitConfig, 'edges'>, type: string): string {
  return toCssColor(config.edges?.[type]?.color);
}

/** Тон вердикта: всё ок — suc, ≥ половины — wrn, меньше — dng, нет вердикта — t3. */
export function verdictTone(v: KitVerdict | undefined): 'suc' | 'wrn' | 'dng' | 't3' {
  if (!v || !(v.max > 0)) return 't3';
  const r = v.score / v.max;
  if (r >= 1 && v.failed.length === 0) return 'suc';
  return r >= 0.5 ? 'wrn' : 'dng';
}
