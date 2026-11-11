// @vitest-environment jsdom
// SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-03 · настройки графа как в Обсидиане: фильтры,
// группы, силы — чистыми функциями.
import { afterEach, describe, expect, it } from 'vitest';
import {
  GX_DEFAULTS, gxFilter, gxForces, gxGroupColor, gxMatches, gxTypeCounts, loadGx, normalizeGx, saveGx,
  type GxEdge, type GxNode,
} from './settings';

const N: GxNode[] = [
  { id: 'ADR-1', type: 'adr', title: 'Граф в kit' },
  { id: 'T-1', type: 'task', title: 'Сделать панель' },
  { id: 'T-2', type: 'task', title: 'Починить данные' },
  { id: 'C-1', type: 'component', title: 'SEIDRKIT_GRAPH' },
  { id: 'LONE', type: 'task', title: 'Без связей' },
];
const E: GxEdge[] = [
  { from: 'T-1', to: 'ADR-1', rel: 'JUSTIFIED_BY' },
  { from: 'T-2', to: 'ADR-1', rel: 'JUSTIFIED_BY' },
  { from: 'ADR-1', to: 'C-1', rel: 'BELONGS_TO' },
];

afterEach(() => localStorage.clear());

describe('GC-03 · фильтры', () => {
  it('по умолчанию ничего не скрыто', () => {
    const f = gxFilter(N, E, GX_DEFAULTS);
    expect(f.nodes).toHaveLength(5);
    expect(f.edges).toHaveLength(3);
    expect(f.total).toBe(5);
  });

  it('скрытый тип уносит свои рёбра; узлы с обеих сторон должны выжить', () => {
    const f = gxFilter(N, E, { ...GX_DEFAULTS, hiddenTypes: ['adr'] });
    expect(f.nodes.map(n => n.id)).toEqual(['T-1', 'T-2', 'C-1', 'LONE']);
    expect(f.edges).toEqual([]);
  });

  it('сироты убираются ПОСЛЕ остальных фильтров — сиротой узел становится из-за них', () => {
    const f = gxFilter(N, E, { ...GX_DEFAULTS, orphans: false, hiddenTypes: ['component'] });
    expect(f.nodes.map(n => n.id)).toEqual(['ADR-1', 'T-1', 'T-2']);
  });

  it('поиск — по коду и названию, без регистра; «type:» — по типу', () => {
    expect(gxFilter(N, E, { ...GX_DEFAULTS, search: 'панель' }).nodes.map(n => n.id)).toEqual(['T-1']);
    expect(gxFilter(N, E, { ...GX_DEFAULTS, search: 'adr-1' }).nodes.map(n => n.id)).toEqual(['ADR-1']);
    expect(gxFilter(N, E, { ...GX_DEFAULTS, search: 'type:task' }).nodes.map(n => n.id)).toEqual(['T-1', 'T-2', 'LONE']);
    expect(gxMatches(N[0], '   ')).toBe(false);
  });

  it('счёт по типам — для чекбоксов панели', () => {
    expect([...gxTypeCounts(N)]).toEqual([['adr', 1], ['task', 3], ['component', 1]]);
  });
});

describe('GC-03 · группы', () => {
  it('первая подошедшая группа красит узел; не подошла ни одна — null (цвет типа)', () => {
    const groups = [{ query: 'type:task', color: '--inf' }, { query: 'панель', color: '--dng' }];
    expect(gxGroupColor(N[1], groups)).toBe('--inf');
    expect(gxGroupColor(N[0], groups)).toBeNull();
  });
});

describe('GC-03 · силы — одна физика на оба движка', () => {
  it('значения Обсидиана по умолчанию дают значения d3 по умолчанию (как у force-graph)', () => {
    expect(gxForces(GX_DEFAULTS)).toEqual({ charge: -30, distance: 30, linkMul: 1, pull: 0.01 });
  });
  it('больше отталкивание — сильнее отрицательный заряд; длиннее связь — больше дистанция', () => {
    const a = gxForces({ ...GX_DEFAULTS, repel: 20, linkDistance: 500 });
    expect(a.charge).toBe(-60);
    expect(a.distance).toBe(60);
  });
});

describe('GC-03 · хранение настроек', () => {
  it('битые значения из хранилища — к значениям по умолчанию и в пределы ползунков', () => {
    const s = normalizeGx({ repel: 999, labels: 'много', groups: [{ query: 1 }], hiddenTypes: ['task', 5] });
    expect(s.repel).toBe(20);
    expect(s.labels).toBe(GX_DEFAULTS.labels);
    expect(s.groups).toEqual([]);
    expect(s.hiddenTypes).toEqual(['task']);
  });
  it('сохранили — прочитали то же; нет записи — значения по умолчанию', () => {
    expect(loadGx('x')).toEqual(GX_DEFAULTS);
    saveGx('x', { ...GX_DEFAULTS, repel: 4, arrows: true });
    expect(loadGx('x')).toMatchObject({ repel: 4, arrows: true });
  });
});
