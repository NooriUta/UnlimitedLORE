// Договор kit на графовые виды (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-02). Замер 11.11.2026 на живых данных
// (5 графов, 110…7 354 узлов) и слова владелицы: React Flow — «под доску и mind map», sigma —
// «тоже прикольная», физика force понравилась поведением. Разбор наработок AIDA — GC-01
// (docs/reports/gc-01-graph-inventory.md).
//
//  · ВХОД ОДИН: узлы {id, type, title} и рёбра (from, rel, to, kind?) — та же форма, что отдаёт
//    сервер /lore/graph и таблица рёбер архива. Ребро договора kit (KitEdge: type) переводится
//    здесь, одним местом, а не каждым экраном.
//  · ОТРИСОВЩИК — по виду и объёму, а не по вкусу экрана (правило ниже). Выбор человека в
//    переключателе вида остаётся главнее для графа знаний; правило — умолчание и потолок.
//  · РАСКЛАДКА — вне главного потока; не уложилась в срок — сказано словами (GraphExplorer).
import type { KitEdge } from '../core/contract';
import type { GxEdge } from './settings';

/** Потолок React Flow: дальше DOM-узлы холста тормозят (замер 11.11, ADR-DA-004 у LOOM). */
export const REACTFLOW_MAX = 300;
/** До стольких узлов граф знаний рисует force-graph (Canvas 2D); больше — sigma (WebGL). */
export const FORCE_MAX = 300;
/** Срок раскладки по умолчанию: дольше — честная плашка «не уложилась в N с». */
export const LAYOUT_TIMEOUT_MS = 8000;

/** Вид графа: доска, mind map, структура (правятся и раскладываются ELK) / граф знаний / «живая» физика. */
export type GraphViewKind = 'board' | 'mindmap' | 'structure' | 'knowledge' | 'live';
/** Отрисовщик: React Flow (DOM + ELK), force-graph (Canvas), sigma + d3-force в воркере (WebGL). */
export type GraphRenderer = 'reactflow' | 'force' | 'obsidian';

export interface RendererChoice {
  /** null — показать нельзя (правка такого объёма); причину называет `reason`. */
  renderer: GraphRenderer | null;
  reason: 'fits' | 'too-many-for-reactflow' | 'edit-too-large' | 'large-graph' | 'live-physics';
}

/** Рёбра договора kit → рёбра графа: `type` → `rel`. */
export function gxEdgesFromKit(edges: readonly KitEdge[]): GxEdge[] {
  return edges.map(e => ({ from: e.from, to: e.to, rel: e.type }));
}

export function chooseGraphRenderer(q: { view: GraphViewKind; nodes: number; editing?: boolean }): RendererChoice {
  if (q.editing) {
    // Правка (перетаскивание, связи руками) — только React Flow; большой граф тихо не подменяем
    // видом без правки: человек должен узнать, что править здесь нельзя.
    return q.nodes <= REACTFLOW_MAX ? { renderer: 'reactflow', reason: 'fits' } : { renderer: null, reason: 'edit-too-large' };
  }
  if (q.view === 'live') return { renderer: 'obsidian', reason: 'live-physics' };
  if (q.view === 'knowledge') return q.nodes <= FORCE_MAX ? { renderer: 'force', reason: 'fits' } : { renderer: 'obsidian', reason: 'large-graph' };
  return q.nodes <= REACTFLOW_MAX ? { renderer: 'reactflow', reason: 'fits' } : { renderer: 'obsidian', reason: 'too-many-for-reactflow' };
}
