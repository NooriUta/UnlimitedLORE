// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-05 — модель фильтров списка: условия
// «есть / нет / пусто / не пусто», поле-массив («Релиз» = release_ids),
// поиск текста в ID и названии, счётчики значений с учётом прочих фильтров
// (как в прототипе v4), наследование поля от родителя (релиз задачи — от её
// спринта, на клиенте) и состояние в URL.
import { describe, expect, it } from 'vitest';
import type { KitRecord } from '../core/contract';
import {
  applyFilterSet, describeFieldFilter, facetOf, inheritField, isFilterActive, matchField, matchText, toFilterSet,
} from './filterModel';
import { DEFAULT_LIST_STATE, matchFilter, readListState, valuesOf, writeListState } from './listModel';

const rec = (id: string, title: string, fields: Record<string, unknown> = {}, status = 'todo'): KitRecord =>
  ({ id, kind: 'sprint', title, status, fields });

const sprints = [
  rec('SPRINT_A', 'Оболочка v2', { release_ids: ['v1.2.0'] }),
  rec('SPRINT_B', 'Фильтры списка', { release_ids: ['v1.2.0', 'v1.3.0'] }),
  rec('SPRINT_C', 'Völva запросы', { release_ids: [] }),
  rec('SPRINT_D', 'Без поля'),
  rec('SPRINT_E', 'Дыры в данных', { release_ids: [null, ''] }),
];
const ids = (rs: KitRecord[]) => rs.map(r => r.id);

describe('valuesOf — значения поля списком', () => {
  it('массив — его непустые элементы; null/""/[]/нет поля — пусто; скаляр — одно значение', () => {
    expect(valuesOf(sprints[1], 'fields.release_ids')).toEqual(['v1.2.0', 'v1.3.0']);
    expect(valuesOf(sprints[2], 'fields.release_ids')).toEqual([]);
    expect(valuesOf(sprints[3], 'fields.release_ids')).toEqual([]);
    expect(valuesOf(sprints[4], 'fields.release_ids')).toEqual([]);
    expect(valuesOf(sprints[0], 'status')).toEqual(['todo']);
    expect(valuesOf(rec('X', 'x', { n: 0 }), 'fields.n')).toEqual(['0']);
  });

  it('matchFilter («Быстро») понимает поле-массив: «без релиза» = пустая строка', () => {
    expect(matchFilter(sprints[1], { 'fields.release_ids': 'v1.3.0' })).toBe(true);
    expect(matchFilter(sprints[0], { 'fields.release_ids': 'v1.3.0' })).toBe(false);
    expect(ids(sprints.filter(r => matchFilter(r, { 'fields.release_ids': '' })))).toEqual(['SPRINT_C', 'SPRINT_D', 'SPRINT_E']);
  });
});

describe('matchField — четыре условия', () => {
  const key = 'fields.release_ids';
  it('есть — хотя бы одно из выбранных', () => {
    expect(ids(sprints.filter(r => matchField(r, key, { op: 'any', values: ['v1.3.0'] })))).toEqual(['SPRINT_B']);
    expect(ids(sprints.filter(r => matchField(r, key, { op: 'any', values: ['v1.2.0', 'v1.3.0'] })))).toEqual(['SPRINT_A', 'SPRINT_B']);
  });
  it('нет — ни одного из выбранных (пустые подходят: у них этого значения нет)', () => {
    expect(ids(sprints.filter(r => matchField(r, key, { op: 'not', values: ['v1.2.0'] })))).toEqual(['SPRINT_C', 'SPRINT_D', 'SPRINT_E']);
  });
  it('пусто / не пусто — значения не нужны', () => {
    expect(ids(sprints.filter(r => matchField(r, key, { op: 'empty', values: [] })))).toEqual(['SPRINT_C', 'SPRINT_D', 'SPRINT_E']);
    expect(ids(sprints.filter(r => matchField(r, key, { op: 'nonempty', values: ['мусор'] })))).toEqual(['SPRINT_A', 'SPRINT_B']);
  });
  it('«есть» / «нет» без значений — фильтр не активен и пропускает всё', () => {
    expect(isFilterActive({ op: 'any', values: [] })).toBe(false);
    expect(isFilterActive({ op: 'not', values: [] })).toBe(false);
    expect(isFilterActive({ op: 'empty', values: [] })).toBe(true);
    expect(sprints.every(r => matchField(r, key, { op: 'not', values: [] }))).toBe(true);
  });
  it('«есть» с пустой строкой среди значений — совместимо со старым фильтром «без значения»', () => {
    expect(ids(sprints.filter(r => matchField(r, key, { op: 'any', values: ['', 'v1.3.0'] }))))
      .toEqual(['SPRINT_B', 'SPRINT_C', 'SPRINT_D', 'SPRINT_E']);
  });
});

describe('matchText — текст в ID, названии и доп. тексте поиска', () => {
  it('без учёта регистра, по ID и по названию, кириллица и диакритика как есть', () => {
    expect(matchText(sprints[0], 'sprint_a')).toBe(true);
    expect(matchText(sprints[0], 'ОБОЛОЧ')).toBe(true);
    expect(matchText(sprints[2], 'völva')).toBe(true);
    expect(matchText(sprints[2], 'оболочка')).toBe(false);
  });
  it('несколько слов — все должны встретиться; пустой текст пропускает всё', () => {
    expect(matchText(sprints[1], 'списка фильтры')).toBe(true);
    expect(matchText(sprints[1], 'списка оболочка')).toBe(false);
    expect(matchText(sprints[1], '   ')).toBe(true);
  });
  // S7B-28: приложение само называет, что ещё искать у записи (логин, проекты,
  // агенты человека) — `search`; без него поиск по-прежнему только ID и название.
  it('доп. текст поиска от приложения (`search`) тоже ищется; слова могут быть в разных частях', () => {
    const person: KitRecord = { id: 'u-1', kind: 'person', title: 'Фролова', status: '', fields: {}, search: 'frolova AIDA/miniLORE Kimi (full)' };
    expect(matchText(person, 'kimi')).toBe(true);
    expect(matchText(person, 'фролова minilore')).toBe(true);
    expect(matchText({ ...person, search: undefined }, 'kimi')).toBe(false);
  });
});

describe('applyFilterSet / facetOf — фильтр и счётчики', () => {
  const set = { fields: { 'fields.release_ids': { op: 'any' as const, values: ['v1.2.0'] } }, text: '' };
  it('поля — через И, плюс текст', () => {
    expect(ids(applyFilterSet(sprints, set))).toEqual(['SPRINT_A', 'SPRINT_B']);
    expect(ids(applyFilterSet(sprints, { ...set, text: 'фильтр' }))).toEqual(['SPRINT_B']);
  });

  it('счётчики значений поля — по выдаче БЕЗ своего фильтра, но с прочими и с текстом', () => {
    const f = facetOf(sprints, set, 'fields.release_ids');
    expect(f.values).toEqual([{ value: 'v1.2.0', count: 2 }, { value: 'v1.3.0', count: 1 }]);
    expect(f.empty).toBe(3);
    expect(f.nonempty).toBe(2);
    expect(f.total).toBe(5);
    const withText = facetOf(sprints, { ...set, text: 'дыры' }, 'fields.release_ids');
    expect(withText).toEqual({ values: [], empty: 1, nonempty: 0, total: 1 });
  });

  it('счётчик другого поля учитывает активный фильтр по релизу', () => {
    const f = facetOf(sprints, set, 'status');
    expect(f.values).toEqual([{ value: 'todo', count: 2 }]);
  });
});

describe('inheritField — поле от родителя (релиз задачи = релиз её спринта)', () => {
  it('копирует поле родителя в fields ребёнка; родителя нет — поле пустое, а не выдуманное', () => {
    const tasks = [
      rec('T1', 'задача 1', { sprint_id: 'SPRINT_B' }),
      rec('T2', 'задача 2', { sprint_id: 'SPRINT_NOPE' }),
      rec('T3', 'задача 3'),
    ];
    const out = inheritField(tasks, sprints, 'fields.sprint_id', 'fields.release_ids', 'release_ids');
    expect(out[0].fields.release_ids).toEqual(['v1.2.0', 'v1.3.0']);
    expect(out[1].fields.release_ids).toEqual([]);
    expect(out[2].fields.release_ids).toEqual([]);
    expect(tasks[0].fields.release_ids).toBeUndefined();
  });
});

describe('состояние в URL — условия и текст', () => {
  it('lo (условия) и lt (текст) пишутся и читаются; по умолчанию не пишутся', () => {
    const s = {
      ...DEFAULT_LIST_STATE,
      filters: { 'fields.release_ids': ['v1.2.0'] },
      ops: { 'fields.release_ids': 'not' as const, 'fields.component_ids': 'empty' as const },
      text: 'völva',
    };
    const w = writeListState(s);
    expect(w.lt).toBe('völva');
    const p = new URLSearchParams(Object.entries(w).filter(([, v]) => v !== null) as [string, string][]);
    const back = readListState(p);
    expect(back.text).toBe('völva');
    expect(back.ops).toEqual({ 'fields.release_ids': 'not', 'fields.component_ids': 'empty' });
    expect(back.filters).toEqual({ 'fields.release_ids': ['v1.2.0'] });
    const d = writeListState(DEFAULT_LIST_STATE);
    expect(d.lo).toBeNull();
    expect(d.lt).toBeNull();
  });

  it('битые или чужие условия в URL отбрасываются, а не роняют экран', () => {
    const p = new URLSearchParams({ lo: '{"a":"drop table","b":"empty"}' });
    expect(readListState(p).ops).toEqual({ b: 'empty' });
    expect(readListState(new URLSearchParams({ lo: '{oops' })).ops).toEqual({});
  });

  it('toFilterSet собирает условия: «есть» по умолчанию, пусто/не пусто без значений', () => {
    const set = toFilterSet({ ...DEFAULT_LIST_STATE, filters: { a: ['1'] }, ops: { b: 'empty' }, text: ' x ' });
    expect(set).toEqual({ fields: { a: { op: 'any', values: ['1'] }, b: { op: 'empty', values: [] } }, text: 'x' });
  });
});

describe('describeFieldFilter — описание словами', () => {
  const t = { any: 'есть', not: 'нет', empty: 'пусто', nonempty: 'не пусто' };
  it('значения через «|», для «нет» — с условием, для пусто — без значений', () => {
    expect(describeFieldFilter({ op: 'any', values: ['a', 'b'] }, t, v => v.toUpperCase())).toBe('A | B');
    expect(describeFieldFilter({ op: 'not', values: ['a'] }, t, v => v)).toBe('нет a');
    expect(describeFieldFilter({ op: 'empty', values: ['a'] }, t, v => v)).toBe('пусто');
  });
});
