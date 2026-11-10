// SPRINT_UXR_S9_SCALE_OPT/S9-03 — фасет на объёме: блоки вместо простыни.
//
// Замер третьего круга критики: фасет оси «разрез» отдавал 428 значений одним
// плоским списком с поиском, но без разделов — нужное значение искали глазами,
// а отмеченное уезжало вниз под первое попавшееся по счёту.
//
// Здесь закреплены правила порядка и ЧЕСТНОСТИ: выбранное видно всегда (иначе
// человек не видит, по чему отфильтровано), «частые» называются частыми только
// когда есть числа, по которым это можно утверждать, а непоказанное называется
// числом, а не многоточием.
import { describe, expect, it } from 'vitest';
import { FACET_SCALE, facetSections } from './facetSections';
import type { FacetBlockKind, FacetSectionsInput, FacetSectionsResult } from './facetSections';

/** N значений по убыванию счёта — тот порядок, в котором их видит человек. */
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ value: `v-${String(i + 1).padStart(3, '0')}`, count: n - i }));

const kinds = (r: FacetSectionsResult) => r.blocks.map(b => b.kind);
const shown = (r: FacetSectionsResult) => r.blocks.flatMap(b => b.values.map(v => v.value));
const block = (r: FacetSectionsResult, kind: FacetBlockKind) => r.blocks.find(b => b.kind === kind);

const sections = (over: Partial<FacetSectionsInput> = {}) =>
  facetSections({ values: many(428), picked: [], ...over });

describe('S9-03 · фасет на объёме: пороги и размеры блоков — одним местом', () => {
  it('порог поиска и размер блока заданы константой, а не числами по коду', () => {
    expect(FACET_SCALE.findFrom).toBeGreaterThan(0);
    expect(FACET_SCALE.block).toBeGreaterThan(0);
    // Блок первого экрана не крупнее порога: иначе «их стало много» наступает
    // позже, чем список перестаёт читаться с одного взгляда.
    expect(FACET_SCALE.block).toBeLessThanOrEqual(FACET_SCALE.findFrom);
  });

  it('ниже порога — один плоский блок без поиска: разделы на девяти значениях только мешают', () => {
    const r = facetSections({ values: many(FACET_SCALE.findFrom - 1), picked: [] });
    expect(kinds(r)).toEqual(['all']);
    expect(r.search).toBe(false);
    expect(r.blocks[0].values).toHaveLength(FACET_SCALE.findFrom - 1);
    expect(r.blocks[0].hidden).toBe(0);
  });

  it('выше порога — появляется поиск, первый экран обрезан до размера блока', () => {
    const n = FACET_SCALE.findFrom + 1;
    const r = facetSections({ values: many(n), picked: [] });
    expect(r.search).toBe(true);
    expect(kinds(r)).toEqual(['frequent']);
    expect(r.blocks[0].values).toHaveLength(FACET_SCALE.block);
    expect(r.blocks[0].hidden).toBe(n - FACET_SCALE.block);
  });
});

describe('S9-03 · порядок блоков: выбранные → закреплённые → частые', () => {
  it('выбранные — первым блоком, целиком и без обрезки: их надо уметь снять', () => {
    const picked = ['v-100', 'v-200', 'v-300'];
    const r = sections({ picked });
    expect(kinds(r)[0]).toBe('picked');
    expect(block(r, 'picked')!.values.map(v => v.value)).toEqual(picked);
    expect(block(r, 'picked')!.hidden).toBe(0);
  });

  it('выбранное не дублируется в «частых» — одно значение показано один раз', () => {
    const r = sections({ picked: ['v-001', 'v-002'] });
    expect(block(r, 'frequent')!.values.map(v => v.value)).not.toContain('v-001');
    const all = shown(r);
    expect(new Set(all).size).toBe(all.length);
  });

  it('закреплённые приложением — между выбранными и частыми', () => {
    const r = sections({ picked: ['v-001'], pinned: ['v-400', 'v-401'] });
    expect(kinds(r)).toEqual(['picked', 'pinned', 'frequent']);
    expect(block(r, 'pinned')!.values.map(v => v.value)).toEqual(['v-400', 'v-401']);
  });

  it('закреплённого значения нет в оси — блок его не выдумывает', () => {
    const r = sections({ picked: [], pinned: ['v-001', 'нет-такого'] });
    expect(block(r, 'pinned')!.values.map(v => v.value)).toEqual(['v-001']);
  });

  it('«частые» берут порядок входа — те же числа, что показаны человеку', () => {
    const r = sections({ picked: [] });
    expect(block(r, 'frequent')!.values.map(v => v.count)).toEqual(
      many(428).slice(0, FACET_SCALE.block).map(v => v.count),
    );
  });

  it('чисел нет (ranked: false) — блок не называется «частыми»', () => {
    const r = sections({ picked: [], ranked: false });
    expect(kinds(r)).toEqual(['first']);
    expect(block(r, 'frequent')).toBeUndefined();
  });
});

describe('S9-03 · честные состояния фасета', () => {
  it('непоказанное названо числом: показанное + скрытое = всего', () => {
    const r = sections({ picked: ['v-100'], pinned: ['v-400'] });
    const hidden = r.blocks.reduce((s, b) => s + b.hidden, 0);
    expect(r.total).toBe(428);
    expect(shown(r).length + hidden).toBe(428);
    expect(hidden).toBeGreaterThan(0);
  });

  it('выбранное видно и при запросе, которому не подходит: иначе не видно, по чему отфильтровано', () => {
    const r = sections({ picked: ['v-100'], query: 'v-42' });
    expect(kinds(r)).toEqual(['picked', 'found']);
    expect(block(r, 'picked')!.values.map(v => v.value)).toEqual(['v-100']);
    expect(block(r, 'found')!.values.every(v => v.value.includes('v-42'))).toBe(true);
    expect(r.noMatch).toBe(false);
  });

  it('по запросу ничего — это «ничего по запросу», а не «значений нет»', () => {
    const r = sections({ picked: ['v-100'], query: 'ничего-такого' });
    expect(r.noMatch).toBe(true);
    expect(r.total).toBe(428);
    expect(kinds(r)).toEqual(['picked']);
  });

  it('пустая ось — не «ничего по запросу»: нечему было находиться', () => {
    const r = facetSections({ values: [], picked: [], query: 'что-нибудь' });
    expect(r.total).toBe(0);
    expect(r.noMatch).toBe(false);
    expect(r.blocks).toEqual([]);
  });

  it('найденного больше блока — остаток назван числом, а не отброшен молча', () => {
    const r = sections({ picked: [], query: 'v-' });
    const found = block(r, 'found')!;
    expect(found.values).toHaveLength(FACET_SCALE.block);
    expect(found.values.length + found.hidden).toBe(428);
  });

  it('поиск идёт и по подписи значения, а не только по его коду', () => {
    const r = sections({ picked: [], query: 'сотое', haystack: v => (v === 'v-100' ? 'сотое значение' : v) });
    expect(block(r, 'found')!.values.map(v => v.value)).toEqual(['v-100']);
  });

  it('ниже порога запрос не фильтрует: поля поиска там нет, и молча прятать нечего', () => {
    const r = facetSections({ values: many(5), picked: [], query: 'v-1' });
    expect(r.search).toBe(false);
    expect(r.blocks[0].values).toHaveLength(5);
    expect(r.noMatch).toBe(false);
  });
});
