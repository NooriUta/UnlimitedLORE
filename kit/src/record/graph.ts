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

/**
 * Потолок однотипных соседей (S9-08). Больше — сектор сворачивается в кластер.
 *
 * Названо ОДНИМ местом: число живёт в модели, а не в вёрстке, иначе холст и
 * подпись однажды разойдутся. Двенадцать — из задачи владельца.
 */
export const GRAPH_CLUSTER_MAX = 12;

export interface EgoSector {
  type: string;
  start: number;
  end: number;
  /** Настоящее число соседей сектора — остаётся правдой и у свёрнутого. */
  count: number;
  /** Сектор свёрнут в кластер: на холсте у него одно место, а не count. */
  clustered?: true;
}

/**
 * Свёрнутый сектор: вместо N кружков — одно место с числом (S9-08).
 *
 * Зачем вообще: у хаба однотипных соседей бывает полторы сотни, и беда не
 * только в числе кружков — сектор такого типа съедает почти всю окружность, а
 * остальные связи, за которыми человек и пришёл, ужимаются в щель. Поэтому
 * свёртка решается ДО раскладки секторов.
 */
export interface EgoCluster {
  /** Ключ раскрытия — тип ребра сектора. */
  key: string;
  sector: string;
  dir: 'out' | 'in';
  /** Сколько узлов спрятано. */
  count: number;
  /** Их коды — по ним строится список связей. */
  ids: string[];
  /**
   * Число неточное: выдача обрезана лимитом, и под кластером может быть
   * больше. Кластер «149», под которым четыреста, хуже каши — каша видна, а
   * неверное число выглядит знанием.
   */
  atLeast: boolean;
  angle: number;
  x: number;
  y: number;
}

export interface EgoGraph {
  center: { id: string; record?: KitRecord };
  nodes: EgoNode[];
  links: KitEdge[];
  sectors: EgoSector[];
  /** Свёрнутые секторы-хабы (S9-08); пусто — свёртки нет. */
  clusters: EgoCluster[];
  /** Сколько узлов достижимо в пределах глубины (до лимита). */
  total: number;
  truncated: boolean;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const edgeKey = (e: KitEdge) => `${e.type}\u0000${e.from}\u0000${e.to}`;

export interface EgoOptions {
  depth: number;
  limit: number;
  /**
   * S5-10: разрешённые типы рёбер (фильтр вкладки и слой структурных связей).
   * Обход идёт только по ним — через выключенное ребро сосед не достижим.
   * Нет — все типы.
   */
  types?: ReadonlySet<string>;
  /**
   * S9-08: потолок однотипных соседей; больше — сектор сворачивается.
   * Умолчание — GRAPH_CLUSTER_MAX. Бесконечность отключает свёртку вовсе.
   */
  clusterMax?: number;
  /** Типы рёбер, чьи секторы человек раскрыл: они рисуются узлами как прежде. */
  expanded?: ReadonlySet<string>;
}

export function egoGraph(centerId: string, data: KitData, opts: EgoOptions): EgoGraph {
  const byId = new Map(data.records.map(r => [r.id, r] as const));
  const edges = [...data.edges]
    .filter(e => e.from !== e.to && (!opts.types || opts.types.has(e.type)))
    .sort((a, b) => cmp(edgeKey(a), edgeKey(b)));
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
  const truncated = all.length > shown.length;
  const types = [...new Set(shown.map(n => n.sector))].sort(cmp);

  // S9-08. Свёртка решается ЗДЕСЬ — до раскладки, — и это главное решение
  // задачи: кластер, посчитанный после, оставил бы хабу его сектор, и три
  // нужные связи остались бы в щели. Свёрнутый сектор весит в раскладке ОДНО
  // место, а его настоящий счёт остаётся в sectors[].count.
  //
  // Сворачивается сектор ЦЕЛИКОМ, со всеми своими кольцами, а не только
  // первое кольцо. Цена названа: раскрытие показывает всю ветку сектора. Зато
  // нет оборванных узлов — спрятать соседа, оставив его соседа висеть в
  // пустоте, читалось бы как связь, которой нет.
  const clusterMax = opts.clusterMax ?? GRAPH_CLUSTER_MAX;
  const expanded = opts.expanded;
  const countOf = (type: string) => shown.filter(n => n.sector === type).length;
  const collapsed = new Set(
    types.filter(t => !expanded?.has(t) && countOf(t) > clusterMax),
  );

  const gap = types.length > 1 ? 0.08 : 0;
  const usable = Math.PI * 2 - gap * types.length;
  // Вес сектора в раскладке: свёрнутый занимает одно место.
  const weightOf = (type: string) => (collapsed.has(type) ? 1 : countOf(type));
  const weightAll = types.reduce((n, t) => n + weightOf(t), 0);
  const sectors: EgoSector[] = [];
  let at = -Math.PI / 2;
  for (const type of types) {
    const count = countOf(type);
    const span = (usable * weightOf(type)) / (weightAll || 1);
    sectors.push(collapsed.has(type)
      ? { type, start: round(at), end: round(at + span), count, clustered: true }
      : { type, start: round(at), end: round(at + span), count });
    at += span + gap;
  }

  const clusters: EgoCluster[] = [];
  for (const s of sectors) {
    if (!s.clustered) continue;
    const inSector = shown.filter(n => n.sector === s.type);
    const angle = round((s.start + s.end) / 2);
    clusters.push({
      key: s.type,
      sector: s.type,
      // Направление берём у первого соседа сектора: сектор — это тип ребра
      // первого шага, и направление у него одно на весь сектор.
      dir: inSector[0]?.dir ?? 'out',
      count: inSector.length,
      ids: inSector.map(n => n.id),
      atLeast: truncated,
      angle,
      x: round(Math.cos(angle)),
      y: round(Math.sin(angle)),
    });
  }

  const nodes: EgoNode[] = [];
  for (const s of sectors) {
    // Свёрнутый сектор рисуется кластером — его узлов на холсте нет.
    if (s.clustered) continue;
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

  const ids = new Set([centerId, ...nodes.map(n => n.id)]);
  const links = edges.filter(e => ids.has(e.from) && ids.has(e.to));
  return {
    center: { id: centerId, record: byId.get(centerId) },
    nodes,
    links,
    sectors,
    clusters,
    total: all.length,
    truncated,
  };
}

/**
 * S5-10: какие типы рёбер есть вокруг записи в пределах глубины — без учёта
 * фильтра и лимита (из этого строятся кнопки фильтра, и выключенный тип не
 * пропадает из списка). count — число рёбер этого типа между достижимыми
 * узлами. Порядок — по типу.
 */
export function typesAround(centerId: string, data: KitData, depth: number): { type: string; count: number }[] {
  // clusterMax: Infinity — свёртка хабов здесь ОБЯЗАНА быть выключена.
  // Иначе тип-хаб исчезает из перечня: его узлы свёрнуты, значит их рёбра не
  // попадают в links, и кнопка фильтра для этого типа не рисуется вовсе —
  // человек теряет возможность включить/выключить ровно тот тип, из-за
  // которого свёртка и случилась. Поймано тестом S9-08 при первом прогоне.
  const g = egoGraph(centerId, data, { depth, limit: Number.MAX_SAFE_INTEGER, clusterMax: Infinity });
  const counts = new Map<string, number>();
  for (const l of g.links) counts.set(l.type, (counts.get(l.type) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => cmp(a[0], b[0])).map(([type, count]) => ({ type, count }));
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
