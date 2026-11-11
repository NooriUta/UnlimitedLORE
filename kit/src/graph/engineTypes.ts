// Общий договор движков графа (GC-03): GraphExplorer отдаёт уже отфильтрованные
// узлы и рёбра, цвета уже посчитаны; движок только рисует и сообщает о щелчке.
import type { GxEdge, GxNode, GxSettings } from './settings';

export interface GxEngineProps {
  nodes: GxNode[];
  edges: GxEdge[];
  /** CSS-цвет узла (группа или тип) — токен или значение; движок разрешает его сам. */
  nodeColor: (n: GxNode) => string;
  /** CSS-цвет ребра по типу связи. */
  edgeColor: (e: GxEdge) => string;
  /** Пунктир для вида связи (soft, informs…) или null. */
  edgeDash: (e: GxEdge) => number[] | null;
  settings: GxSettings;
  /** Выбранный узел — его соседи подсвечены, остальное притушено. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Двойной щелчок — открыть запись. */
  onOpen?: (id: string) => void;
  /** Ошибка загрузки библиотеки или отрисовки — показать честно, а не пустым холстом. */
  onError: (e: unknown) => void;
}

/** Цвет-подложка, когда токен не нашёлся: ключевое слово CSS, не сырое значение. */
export const FALLBACK = 'gray';

/** CSS-цвет («--acc», «var(--acc)» или готовое значение) → значение для canvas/WebGL. */
export function resolveColor(el: Element | null, c: string): string {
  const v = c.trim();
  // Запасное значение может само быть var(…) — «var(--suc, var(--t3))», как отдаёт
  // toCssColor; поэтому хвост берётся жадно до последней скобки, а не до первой.
  const m = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(v);
  const name = v.startsWith('--') ? v : m?.[1];
  if (!name) return v;
  const got = el ? getComputedStyle(el).getPropertyValue(name).trim() : '';
  if (got) return got;
  return m?.[2] ? resolveColor(el, m[2]) : FALLBACK;
}

/** Соседи узла (вместе с ним) — для подсветки. */
export function neighborsOf(id: string, edges: readonly GxEdge[]): Set<string> {
  const s = new Set([id]);
  for (const e of edges) { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from); }
  return s;
}
