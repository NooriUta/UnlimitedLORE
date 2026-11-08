// Состояние вкладки «Граф» (SPRINT_UXR_S5_RECORD_TASKS/S5-10): глубина 1–3,
// выключенные типы рёбер, слой структурных связей. Живёт в URL (ссылкой
// можно поделиться, «Назад» работает), значения по умолчанию параметр снимают.
//
// Слой структурных связей: тип ребра с config.edges[type].layer === 'structural'
// — это принадлежность и иерархия (версия записи, проект, фаза, родитель), а не
// связь по смыслу. По умолчанию скрыт: иначе хаб «спринт» или «проект»
// заливает граф и прячет смысловые связи.
import { useCallback, useMemo } from 'react';
import type { KitConfig } from '../core/contract';
import { setUrlParams, useUrlParam } from '../resilience/useUrlParam';

export const GRAPH_PARAMS = { depth: 'gdepth', off: 'goff', layer: 'glayer' } as const;
const LAYER_ON = 'struct';

export type GraphDepth = 1 | 2 | 3;
export const GRAPH_DEPTHS: readonly GraphDepth[] = [1, 2, 3];

export interface GraphState {
  depth: GraphDepth;
  /** Выключенные типы рёбер, по порядку, без дублей. */
  off: string[];
  /** Слой структурных связей показан. */
  structural: boolean;
}

interface ParamReader { get(key: string): string | null }

function configDepth(config: Pick<KitConfig, 'graph'>): GraphDepth {
  const d = config.graph?.depth;
  return d === 1 || d === 2 || d === 3 ? d : 1;
}

function parseDepth(raw: string | null, fallback: GraphDepth): GraphDepth {
  const n = Number(raw);
  return n === 1 || n === 2 || n === 3 ? n : fallback;
}

function parseOff(raw: string | null): string[] {
  return [...new Set((raw ?? '').split(',').map(s => s.trim()).filter(Boolean))].sort();
}

export function parseGraphState(params: ParamReader, config: Pick<KitConfig, 'graph'>): GraphState {
  return {
    depth: parseDepth(params.get(GRAPH_PARAMS.depth), configDepth(config)),
    off: parseOff(params.get(GRAPH_PARAMS.off)),
    structural: params.get(GRAPH_PARAMS.layer) === LAYER_ON,
  };
}

/** Состояние → патч URL; значение по умолчанию — null (параметр снимается). */
export function graphStateParams(s: GraphState, config: Pick<KitConfig, 'graph'>): Record<string, string | null> {
  const off = parseOff(s.off.join(','));
  return {
    [GRAPH_PARAMS.depth]: s.depth === configDepth(config) ? null : String(s.depth),
    [GRAPH_PARAMS.off]: off.length ? off.join(',') : null,
    [GRAPH_PARAMS.layer]: s.structural ? LAYER_ON : null,
  };
}

export function isStructural(config: Pick<KitConfig, 'edges'>, type: string): boolean {
  return config.edges?.[type]?.layer === 'structural';
}

/** Подпись типа ребра словами; нет в конфиге — код типа (а не пустота). */
export function edgeLabel(config: Pick<KitConfig, 'edges'>, type: string): string {
  return config.edges?.[type]?.label?.trim() || type;
}

/** Разрешённые типы: без выключенных и без структурных, пока слой скрыт. */
export function allowedEdgeTypes(types: readonly string[], config: Pick<KitConfig, 'edges'>, s: GraphState): Set<string> {
  const off = new Set(s.off);
  return new Set(types.filter(t => !off.has(t) && (s.structural || !isStructural(config, t))));
}

export interface GraphStateApi {
  state: GraphState;
  setDepth: (d: GraphDepth) => void;
  /** Включить/выключить тип ребра. */
  toggleType: (type: string) => void;
  setStructural: (on: boolean) => void;
  /** Сбросить фильтр типов; структурный слой — по аргументу. */
  reset: (structural: boolean) => void;
}

/** Состояние графа из URL (query + «#»-фолбэк, useUrlParam K-06). */
export function useGraphState(config: Pick<KitConfig, 'graph'>): GraphStateApi {
  const [depthRaw] = useUrlParam(GRAPH_PARAMS.depth);
  const [offRaw] = useUrlParam(GRAPH_PARAMS.off);
  const [layerRaw] = useUrlParam(GRAPH_PARAMS.layer);
  const state = useMemo(
    () => parseGraphState({ get: k => (k === GRAPH_PARAMS.depth ? depthRaw : k === GRAPH_PARAMS.off ? offRaw : layerRaw) }, config),
    [depthRaw, offRaw, layerRaw, config],
  );
  const write = useCallback((next: GraphState) => { setUrlParams(graphStateParams(next, config), { replace: true }); }, [config]);
  return {
    state,
    setDepth: d => write({ ...state, depth: d }),
    toggleType: type => write({ ...state, off: state.off.includes(type) ? state.off.filter(t => t !== type) : [...state.off, type] }),
    setStructural: on => write({ ...state, structural: on }),
    reset: structural => write({ ...state, off: [], structural }),
  };
}
