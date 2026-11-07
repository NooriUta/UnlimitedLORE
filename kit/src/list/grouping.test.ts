// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-06 — общая группировка поверх движка списка:
// один ключ группы (поле, статус или разрез по связи) даёт группы списка,
// дорожки доски и дорожки таймлайна; разрезы по связям — пресеты из конфига.
import { describe, expect, it } from 'vitest';
import type { KitConfig, KitData, KitEdge, KitRecord } from '../core/contract';
import {
  boardLanes, groupBy, groupingOptions, parseGroupKey, timelineLanes,
} from './grouping';

const rec = (id: string, status: string, fields: Record<string, unknown> = {}, kind = 'task'): KitRecord =>
  ({ id, kind, title: `T ${id}`, status, fields });

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' }, sprint: { title: 'Спринты', icon: 'sprint' } },
  edges: { IN_SPRINT: { label: 'спринт', color: 'var(--acc)' }, DEPENDS_ON: { label: 'зависит от', color: 'var(--inf)' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'active', title: 'в работе', category: 'active', icon: 'progression', color: 'var(--acc)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list', 'board'], groupings: ['status', 'fields.area', 'rel:IN_SPRINT', 'rel:DEPENDS_ON:in'] },
};

const S1 = rec('S1', 'active', {}, 'sprint');
const tasks = [
  rec('A', 'todo', { area: 'ui', start: '2026-11-01', end: '2026-11-05' }),
  rec('B', 'done', { area: 'api', start: '2026-11-03', end: '2026-11-10' }),
  rec('C', 'active', { area: 'ui' }),
  rec('D', 'todo', { area: 'ui', start: '2026-11-02' }),
];
const edges: KitEdge[] = [
  { from: 'A', to: 'S1', type: 'IN_SPRINT' },
  { from: 'B', to: 'S1', type: 'IN_SPRINT' },
  { from: 'C', to: 'S2', type: 'IN_SPRINT' }, // S2 не загружен
  { from: 'D', to: 'S1', type: 'IN_SPRINT' },
  { from: 'D', to: 'S2', type: 'IN_SPRINT' }, // D — в двух спринтах
  { from: 'B', to: 'A', type: 'DEPENDS_ON' },
];
const data: KitData = { records: [...tasks, S1], edges, journal: [], meta: { generated_at: '2026-11-07T00:00:00Z' } };

describe('parseGroupKey — ключ группы', () => {
  it('нет / поле / разрез по связи (исходящие и входящие)', () => {
    expect(parseGroupKey(null)).toEqual({ type: 'none' });
    expect(parseGroupKey('')).toEqual({ type: 'none' });
    expect(parseGroupKey('status')).toEqual({ type: 'field', key: 'status' });
    expect(parseGroupKey('fields.area')).toEqual({ type: 'field', key: 'fields.area' });
    expect(parseGroupKey('rel:IN_SPRINT')).toEqual({ type: 'rel', edge: 'IN_SPRINT', dir: 'out' });
    expect(parseGroupKey('rel:DEPENDS_ON:in')).toEqual({ type: 'rel', edge: 'DEPENDS_ON', dir: 'in' });
  });
  it('битый разрез (rel: без типа) — без группировки, а не падение', () => {
    expect(parseGroupKey('rel:')).toEqual({ type: 'none' });
  });
});

describe('groupingOptions — поля и пресеты разрезов из конфига', () => {
  it('поля отдельно, разрезы по связям — пресетами с подписью из config.edges', () => {
    const o = groupingOptions(config);
    expect(o.fields).toEqual(['status', 'fields.area']);
    expect(o.relations.map(p => [p.key, p.edge, p.dir, p.label])).toEqual([
      ['rel:IN_SPRINT', 'IN_SPRINT', 'out', 'спринт'],
      ['rel:DEPENDS_ON:in', 'DEPENDS_ON', 'in', 'зависит от'],
    ]);
  });
  it('тип связи вне словаря config.edges — подпись = код, пресет помечен unknown', () => {
    const o = groupingOptions({ ...config, list: { views: ['list'], groupings: ['rel:NOPE'] } });
    expect(o.relations[0]).toMatchObject({ key: 'rel:NOPE', label: 'NOPE', unknown: true });
  });
});

describe('groupBy — один механизм для поля и связи', () => {
  it('поле — как groupRecords (статус порядком словаря)', () => {
    expect(groupBy(tasks, 'status', config, data).map(g => g.key)).toEqual(['todo', 'active', 'done']);
    expect(groupBy(tasks, null, config, data)).toHaveLength(1);
  });

  it('разрез по исходящей связи: группа = связанная запись; запись в двух — в обеих; без связи — последней', () => {
    const extra = rec('E', 'todo');
    const gs = groupBy([...tasks, extra], 'rel:IN_SPRINT', config, data);
    expect(gs.map(g => [g.key, g.records.map(r => r.id)])).toEqual([
      ['S1', ['A', 'B', 'D']],
      ['S2', ['C', 'D']],
      ['', ['E']],
    ]);
    expect(gs[0].title).toBe('T S1');
    // связанная запись не загружена — честно помечено, не выдумано название
    expect(gs[1]).toMatchObject({ missing: true });
    expect(gs[1].title).toBeUndefined();
    expect(gs[2]).toMatchObject({ none: true });
  });

  it('разрез по входящей связи: группа = источник связи', () => {
    const gs = groupBy(tasks, 'rel:DEPENDS_ON:in', config, data);
    expect(gs.map(g => [g.key, g.records.map(r => r.id)])).toEqual([
      ['B', ['A']],
      ['', ['B', 'C', 'D']],
    ]);
  });

  it('бюджет S9 действует и на разрезы: >maxGroups — топ-N + «Прочие» без дублей', () => {
    const many = Array.from({ length: 6 }, (_, i) => rec(`R${i}`, 'todo'));
    const es: KitEdge[] = many.map((r, i) => ({ from: r.id, to: `G${i}`, type: 'IN_SPRINT' }));
    const d: KitData = { ...data, records: many, edges: es };
    const gs = groupBy(many, 'rel:IN_SPRINT', config, d, { maxGroups: 4, topGroups: 2 });
    expect(gs).toHaveLength(3);
    expect(gs[2]).toMatchObject({ other: true, groupCount: 4 });
    expect(gs[2].records).toHaveLength(4);
  });
});

describe('boardLanes — дорожки доски той же группировкой', () => {
  it('каждая дорожка — колонки всех статусов словаря', () => {
    const lanes = boardLanes(tasks, 'fields.area', config, data);
    expect(lanes.map(l => l.lane.key)).toEqual(['ui', 'api']);
    expect(lanes[0].columns.map(c => [c.key, c.records.map(r => r.id)])).toEqual([
      ['todo', ['A', 'D']], ['active', ['C']], ['done', []],
    ]);
  });
  it('без группировки или группировка по статусу — одна дорожка', () => {
    expect(boardLanes(tasks, null, config, data)).toHaveLength(1);
    expect(boardLanes(tasks, 'status', config, data)).toHaveLength(1);
  });
});

describe('timelineLanes — дорожки таймлайна той же группировкой', () => {
  it('элементы с датами раскладываются по дорожкам; без даты начала — честно в undated', () => {
    const t = timelineLanes(tasks, 'rel:IN_SPRINT', config, data, { start: 'fields.start', end: 'fields.end' });
    expect(t.lanes.map(l => [l.lane.key, l.items.map(i => i.record.id)])).toEqual([
      ['S1', ['A', 'B', 'D']],
      ['S2', ['D']],
    ]);
    expect(t.undated.map(r => r.id)).toEqual(['C']);
    expect(t.range).toEqual({ min: '2026-11-01', max: '2026-11-10' });
  });
  it('нет конца — точка (end = start); конец раньше начала — переставляются', () => {
    const rs = [rec('X', 'todo', { s: '2026-11-05' }), rec('Y', 'todo', { s: '2026-11-09', e: '2026-11-02' })];
    const t = timelineLanes(rs, null, config, { ...data, records: rs }, { start: 'fields.s', end: 'fields.e' });
    expect(t.lanes[0].items.map(i => [i.start, i.end])).toEqual([['2026-11-05', '2026-11-05'], ['2026-11-02', '2026-11-09']]);
  });
  it('невалидная дата — в undated, а не NaN на шкале', () => {
    const rs = [rec('Z', 'todo', { s: 'вчера' })];
    const t = timelineLanes(rs, null, config, { ...data, records: rs }, { start: 'fields.s' });
    expect(t.undated.map(r => r.id)).toEqual(['Z']);
    expect(t.range).toBeNull();
  });
});
