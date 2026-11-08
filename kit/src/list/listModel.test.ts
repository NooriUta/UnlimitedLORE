// SPRINT_UXR_S10_SEIDR_KIT/K-03 — модель listView: фильтр, «Быстро»,
// группировка с бюджетом S9, порядок, честное «Показано N из M», состояние в URL.
import { describe, expect, it } from 'vitest';
import type { KitConfig, KitRecord } from '../core/contract';
import {
  LIST_BUDGET, applyFilters, boardColumns, fieldValue, groupRecords, matchFilter,
  quickCounts, readListState, shownOf, sortRecords, writeListState,
} from './listModel';

const rec = (id: string, status: string, fields: Record<string, unknown> = {}, extra: Partial<KitRecord> = {}): KitRecord =>
  ({ id, kind: 'task', title: id, status, fields, ...extra });

const config: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'active', title: 'в работе', category: 'active', icon: 'progression', color: 'var(--acc)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
};

describe('fieldValue — поле по ключу', () => {
  it('верхний уровень, fields.x, вложенный путь, голое имя поля', () => {
    const r = rec('A', 'done', { disc: 'x', review: { status: 'ok' } });
    expect(fieldValue(r, 'status')).toBe('done');
    expect(fieldValue(r, 'fields.disc')).toBe('x');
    expect(fieldValue(r, 'fields.review.status')).toBe('ok');
    expect(fieldValue(r, 'disc')).toBe('x');
    expect(fieldValue(r, 'nope')).toBeUndefined();
  });
});

describe('matchFilter / applyFilters', () => {
  const rs = [rec('A', 'done', { c: 'X' }), rec('B', '', { c: 'Y' }), rec('C', 'active')];
  it('строка — равенство, массив — любое из, пустая строка — нет значения', () => {
    expect(matchFilter(rs[0], { status: 'done' })).toBe(true);
    expect(matchFilter(rs[0], { status: ['active', 'done'] })).toBe(true);
    expect(matchFilter(rs[1], { status: '' })).toBe(true);
    expect(matchFilter(rs[2], { 'fields.c': '' })).toBe(true);
    expect(matchFilter(rs[0], { 'fields.c': '' })).toBe(false);
  });
  it('несколько фильтров — И', () => {
    expect(applyFilters(rs, [{ status: ['done', ''] }, { 'fields.c': 'Y' }]).map(r => r.id)).toEqual(['B']);
    expect(applyFilters(rs, []).length).toBe(3);
  });
});

describe('quickCounts — «Быстро»-счётчики', () => {
  it('считаются по выдаче с учётом прочих фильтров, а не по всей базе', () => {
    const rs = [rec('A', 'done', { c: 'X' }), rec('B', 'done', { c: 'Y' }), rec('C', 'active', { c: 'X' })];
    const quick = [{ id: 'd', title: 'готово', filter: { status: 'done' } }, { id: 'a', title: 'в работе', filter: { status: 'active' } }];
    expect(quickCounts(rs, quick, [])).toEqual({ d: 2, a: 1 });
    expect(quickCounts(rs, quick, [{ 'fields.c': 'X' }])).toEqual({ d: 1, a: 1 });
  });
});

describe('groupRecords — группы по правилам S9', () => {
  it('по статусу — в порядке словаря; статус вне словаря — своя группа, не «к работе»', () => {
    const rs = [rec('A', 'done'), rec('B', 'todo'), rec('C', 'weird'), rec('D', 'active')];
    const gs = groupRecords(rs, 'status', config);
    expect(gs.map(g => g.key)).toEqual(['todo', 'active', 'done', 'weird']);
    expect(gs.find(g => g.key === 'weird')?.unknown).toBe(true);
  });

  it(`больше ${LIST_BUDGET.maxGroups} групп → топ-${LIST_BUDGET.topGroups} по размеру + «Прочие»`, () => {
    const rs: KitRecord[] = [];
    for (let g = 0; g < 25; g++) for (let i = 0; i <= g; i++) rs.push(rec(`g${g}-${i}`, 'todo', { s: `S${g}` }));
    const gs = groupRecords(rs, 'fields.s', config);
    expect(gs).toHaveLength(LIST_BUDGET.topGroups + 1);
    expect(gs[0].key).toBe('S24');
    const other = gs[gs.length - 1];
    expect(other.other).toBe(true);
    expect(other.groupCount).toBe(15);
    expect(gs.reduce((n, g) => n + g.records.length, 0)).toBe(rs.length);
  });

  it('без группировки — одна группа со всеми записями', () => {
    const gs = groupRecords([rec('A', 'done'), rec('B', 'done')], null, config);
    expect(gs).toHaveLength(1);
    expect(gs[0].records).toHaveLength(2);
  });
});

describe('boardColumns — колонки доски', () => {
  it('все статусы словаря (пустые тоже) и «вне словаря» только если такие есть', () => {
    expect(boardColumns([rec('A', 'done')], config).map(c => c.key)).toEqual(['todo', 'active', 'done']);
    expect(boardColumns([rec('A', 'x')], config).map(c => c.key)).toEqual(['todo', 'active', 'done', 'x']);
  });
});

describe('sortRecords — порядок', () => {
  const rs = [rec('b', 'done'), rec('a', 'todo'), rec('c', 'active')];
  it('по заголовку и обратно', () => {
    expect(sortRecords(rs, { key: 'title', dir: 'asc' }, config).map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortRecords(rs, { key: 'title', dir: 'desc' }, config).map(r => r.id)).toEqual(['c', 'b', 'a']);
  });
  it('по статусу — порядком словаря, а не алфавитом', () => {
    expect(sortRecords(rs, { key: 'status', dir: 'asc' }, config).map(r => r.status)).toEqual(['todo', 'active', 'done']);
  });
  it('не мутирует вход', () => {
    sortRecords(rs, { key: 'title', dir: 'asc' }, config);
    expect(rs.map(r => r.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('shownOf — «Показано N из M» из meta (формат K-01)', () => {
  it('полная выдача: M = total', () => {
    expect(shownOf({ generated_at: '', total: 10, returned: 10, truncated: false }, 10, 4))
      .toEqual({ kind: 'complete', shown: 4, loaded: 10, total: 10 });
  });
  it('без total и без truncated — M = загружено', () => {
    expect(shownOf({ generated_at: '' }, 7, 7)).toEqual({ kind: 'complete', shown: 7, loaded: 7, total: 7 });
  });
  it('truncated + total: M — серверный итог, загружено меньше', () => {
    expect(shownOf({ generated_at: '', total: 240, returned: 181, truncated: true }, 181, 50))
      .toEqual({ kind: 'truncated', shown: 50, loaded: 181, total: 240 });
  });
  it('truncated без total — итог неизвестен, «из M» не выдумываем', () => {
    expect(shownOf({ generated_at: '', truncated: true }, 181, 181))
      .toEqual({ kind: 'unknown_total', shown: 181, loaded: 181 });
  });
  it('total больше загруженного без флага — тоже обрезано (флаг потеряли — не верим «полной»)', () => {
    expect(shownOf({ generated_at: '', total: 300 }, 200, 200).kind).toBe('truncated');
  });
});

describe('состояние списка в URL', () => {
  it('туда и обратно', () => {
    const st = { view: 'board' as const, quick: 'bad', group: 'fields.disc', sort: { key: 'title', dir: 'desc' as const },
      filters: { status: ['fix', ''], 'fields.disc': ['Сон о числах'] }, ops: {}, text: '' };
    const patch = writeListState(st);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(patch)) if (v != null) params.set(k, v);
    expect(readListState(new URLSearchParams(params.toString()))).toEqual(st);
  });
  it('пустое состояние — ключи удаляются, чтение даёт значения по умолчанию', () => {
    const patch = writeListState({ view: 'list', quick: null, group: null, sort: null, filters: {}, ops: {}, text: '' });
    expect(Object.values(patch).every(v => v === null)).toBe(true);
    expect(readListState(new URLSearchParams())).toEqual({ view: 'list', quick: null, group: null, sort: null, filters: {}, ops: {}, text: '' });
  });
});
