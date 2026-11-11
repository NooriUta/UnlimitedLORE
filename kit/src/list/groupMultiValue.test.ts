// Разрез по полю-массиву (долг kit из ACL-3, сессия 50109daa 11.11.2026):
// «группировка по полю-массиву (например, projects) даёт группу на каждое
// сочетание значений, а не на каждое значение. Машина с [A, B] попадает в группу
// "A, B", а не в A и B по отдельности».
// Корень: groupRecords ключевал массив целиком (valueKey → JSON). Разрез по связи
// уже был многозначным — у поля теперь то же правило: запись в КАЖДОЙ группе
// своего значения, пустой массив — группа «без значения»; в «Прочих» без дублей.
import { describe, expect, it } from 'vitest';
import type { KitConfig, KitRecord } from '../core/contract';
import { groupRecords } from './listModel';

const cfg: KitConfig = { modules: [], menu: { groups: [] }, kinds: {}, statuses: { items: [] } };
const r = (id: string, projects: unknown): KitRecord => ({ id, kind: 'm', title: id, status: '', fields: { projects } });

describe('разрез по полю-массиву', () => {
  it('запись с [A, B] — и в группе A, и в группе B, а не в группе «A, B»', () => {
    const g = groupRecords([r('m1', ['A', 'B']), r('m2', ['A']), r('m3', ['B'])], 'fields.projects', cfg);
    const by = Object.fromEntries(g.map(x => [x.key, x.records.map(y => y.id)]));
    expect(by).toEqual({ A: ['m1', 'm2'], B: ['m1', 'm3'] });
  });

  it('пустой массив и отсутствие поля — одна группа «без значения»', () => {
    const g = groupRecords([r('m1', []), r('m2', undefined), r('m3', ['A'])], 'fields.projects', cfg);
    expect(g.find(x => x.key === '')?.records.map(y => y.id)).toEqual(['m1', 'm2']);
  });

  it('скалярное поле — как раньше', () => {
    const g = groupRecords([r('m1', 'A'), r('m2', 'A'), r('m3', 'B')], 'fields.projects', cfg);
    expect(g.map(x => [x.key, x.records.length])).toEqual([['A', 2], ['B', 1]]);
  });

  it('много групп — «Прочие» без дублей записи', () => {
    const recs = Array.from({ length: 30 }, (_, i) => r(`m${i}`, [`P${i}`, `Q${i}`]));
    const g = groupRecords(recs, 'fields.projects', cfg, { maxGroups: 20, topGroups: 10 });
    const other = g.find(x => x.other)!;
    expect(new Set(other.records.map(y => y.id)).size).toBe(other.records.length);
  });
});
