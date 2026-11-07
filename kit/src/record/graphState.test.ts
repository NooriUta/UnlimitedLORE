// SPRINT_UXR_S5_RECORD_TASKS/S5-10 · состояние вкладки «Граф»: глубина 1–3,
// фильтр типов рёбер, слой структурных связей — чистые правила, состояние в URL.
import { describe, expect, it } from 'vitest';
import type { KitConfig } from '../core/contract';
import {
  GRAPH_PARAMS, allowedEdgeTypes, edgeLabel, graphStateParams, isStructural, parseGraphState,
} from './graphState';

const cfg = {
  edges: {
    DECIDED_IN: { label: 'решено в', color: '--acc' },
    PART_OF: { label: 'входит в', color: '--t3', layer: 'structural' },
    REFERENCES: { label: 'упоминает', color: '--inf' },
  },
  graph: { depth: 2, limit: 60 },
} as unknown as KitConfig;

const q = (s: string) => new URLSearchParams(s);

describe('S5-10 · parseGraphState', () => {
  it('без параметров — глубина из конфига, ничего не выключено, структурный слой скрыт', () => {
    expect(parseGraphState(q(''), cfg)).toEqual({ depth: 2, off: [], structural: false });
  });

  it('конфига graph нет — глубина 1', () => {
    expect(parseGraphState(q(''), {} as KitConfig).depth).toBe(1);
  });

  it('глубина из URL 1..3; мусор и выход за диапазон — к конфигу', () => {
    expect(parseGraphState(q('gdepth=3'), cfg).depth).toBe(3);
    expect(parseGraphState(q('gdepth=1'), cfg).depth).toBe(1);
    expect(parseGraphState(q('gdepth=7'), cfg).depth).toBe(2);
    expect(parseGraphState(q('gdepth=abc'), cfg).depth).toBe(2);
  });

  it('выключенные типы — CSV, без пустых и дублей, по порядку', () => {
    expect(parseGraphState(q('goff=REFERENCES,,DECIDED_IN,REFERENCES'), cfg).off).toEqual(['DECIDED_IN', 'REFERENCES']);
  });

  it('структурный слой — glayer=struct', () => {
    expect(parseGraphState(q('glayer=struct'), cfg).structural).toBe(true);
    expect(parseGraphState(q('glayer=nope'), cfg).structural).toBe(false);
  });

  it('туда-обратно через URL без потерь; значения по умолчанию снимают параметр', () => {
    const s = { depth: 3 as const, off: ['REFERENCES'], structural: true };
    const p = graphStateParams(s, cfg);
    expect(p).toEqual({ [GRAPH_PARAMS.depth]: '3', [GRAPH_PARAMS.off]: 'REFERENCES', [GRAPH_PARAMS.layer]: 'struct' });
    const back = new URLSearchParams(Object.entries(p).filter(([, v]) => v != null) as [string, string][]);
    expect(parseGraphState(back, cfg)).toEqual(s);
    expect(graphStateParams({ depth: 2, off: [], structural: false }, cfg))
      .toEqual({ [GRAPH_PARAMS.depth]: null, [GRAPH_PARAMS.off]: null, [GRAPH_PARAMS.layer]: null });
  });
});

describe('S5-10 · слой и фильтр типов', () => {
  it('структурный тип — по config.edges[type].layer', () => {
    expect(isStructural(cfg, 'PART_OF')).toBe(true);
    expect(isStructural(cfg, 'DECIDED_IN')).toBe(false);
    expect(isStructural(cfg, 'UNKNOWN')).toBe(false);
  });

  it('разрешённые типы: без выключенных и без структурных, пока слой скрыт', () => {
    const all = ['DECIDED_IN', 'PART_OF', 'REFERENCES'];
    expect([...allowedEdgeTypes(all, cfg, { depth: 1, off: [], structural: false })].sort()).toEqual(['DECIDED_IN', 'REFERENCES']);
    expect([...allowedEdgeTypes(all, cfg, { depth: 1, off: ['REFERENCES'], structural: true })].sort()).toEqual(['DECIDED_IN', 'PART_OF']);
  });

  it('подпись ребра — из конфига; неизвестный тип — его код, а не пусто', () => {
    expect(edgeLabel(cfg, 'DECIDED_IN')).toBe('решено в');
    expect(edgeLabel(cfg, 'NEW_EDGE')).toBe('NEW_EDGE');
  });
});
