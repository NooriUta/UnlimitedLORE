// Список вех: прогресс «задачи x/y», «Изменены», без дубля «Продукт/Продукты»
// (SPRINT_UXR_POLISH_UAT_1113/PU-27).
//
// Скрин владелицы 13.11: в списке вех (46 записей) нет прогресса, как у
// спринтов (S4-09); две колонки «Продукт» и «Продукты» с одним и тем же, два
// фильтра «ПРОДУКТЫ»/«ПРОДУКТ»; «ИЗМЕНЕНЫ недоступно».
//
// Причины (проверены): x/y у вех просто не подключали; «Продукты» — своё поле
// вехи (products), а «Продукт» — общая колонка краски продукта (productPaint),
// которая у вехи уже включает её собственные продукты; changed_at срез вех
// отдаёт (changedAtSql), но маппер вехи его не читал — у записи не было времени.
import { describe, expect, it } from 'vitest';
import type { KitRecord } from '@seidr/kit';
import { loadMilestoneTotals } from './milestoneTotals';
import { milestoneRecord } from '../lists/records';
import { LIST_SCREENS } from '../lists/screens';
import { withProductColumn, PRODUCT_COLUMN } from '../lists/productPaint';
import type { LoreClient } from '../sprints/loreClient';

const totals = (id: string, done: number, of: number) => ({
  sprint_id: id, state: 'ok',
  tasks_total: { value: of, known: of, of, done },
  effort_days_total: { value: null, known: 0, of },
  actual_days_total: { value: null, known: 0, of },
});

function client(rowsFor: (ids: string[]) => unknown[] | Error) {
  const calls: string[][] = [];
  const c = {
    slice: async (_name: string, params: Record<string, string>) => {
      const ids = (params.sprint_ids ?? '').split(',').filter(Boolean);
      calls.push(ids);
      const r = rowsFor(ids);
      if (r instanceof Error) throw r;
      return { rows: r, truncated: false, inputs_truncated: false };
    },
  } as unknown as LoreClient;
  return { c, calls };
}

const ms = (id: string, sprints: (string | null)[]): KitRecord =>
  milestoneRecord({ milestone_id: id, label: id, direct_sprint_ids: sprints, products: ['OMILORE'], changed_at: '2026-11-13T15:30:50Z' });

const TOT: Record<string, [number, number]> = { S1: [3, 5], S2: [1, 4], S3: [0, 2] };

describe('PU-27 · «задачи x/y» вехи = сумма по её спринтам', () => {
  it('x и y — суммы итогов спринтов вехи (сервер считает спринты, веха их складывает)', async () => {
    const { c, calls } = client(ids => ids.map(id => totals(id, ...TOT[id])));
    const recs = [ms('M1', ['S1', 'S2', null]), ms('M2', ['S2', 'S3'])];
    const out = await loadMilestoneTotals(c, recs.map(r => r.id), new AbortController().signal, recs);
    expect(out.get('M1')).toEqual({ tasks: { done: 4, total: 9 } });
    expect(out.get('M2')).toEqual({ tasks: { done: 1, total: 6 } });
    // Общий спринт S2 запрошен ОДИН раз — один запрос на все вехи.
    expect(calls.flat().sort()).toEqual(['S1', 'S2', 'S3']);
  });

  it('веха без спринтов — проверенный ноль 0/0', async () => {
    const { c } = client(() => []);
    const recs = [ms('M0', [null])];
    const out = await loadMilestoneTotals(c, ['M0'], new AbortController().signal, recs);
    expect(out.get('M0')).toEqual({ tasks: { done: 0, total: 0 } });
  });

  it('итоги хоть одного спринта не пришли — у вехи причина словами, а не заниженная сумма', async () => {
    const { c } = client(ids => ids.filter(id => id !== 'S2').map(id => totals(id, ...TOT[id])));
    const recs = [ms('M1', ['S1', 'S2']), ms('M3', ['S1'])];
    const out = await loadMilestoneTotals(c, ['M1', 'M3'], new AbortController().signal, recs);
    expect((out.get('M1')?.tasks as { error?: string }).error).toBeTruthy();
    expect(out.get('M3')).toEqual({ tasks: { done: 3, total: 5 } });
  });

  it('сбой среза итогов — причина у каждой вехи, а не пустота', async () => {
    const { c } = client(() => new Error('HTTP 502'));
    const recs = [ms('M1', ['S1'])];
    const out = await loadMilestoneTotals(c, ['M1'], new AbortController().signal, recs);
    expect((out.get('M1')?.tasks as { error?: string }).error).toMatch(/502/);
  });
});

describe('PU-27 · экран вех', () => {
  const cfg = LIST_SCREENS.milestones.config('ru');

  it('колонка прогресса «задачи x/y», как у спринтов', () => {
    expect(cfg.list?.columns).toContain('progress:tasks');
    expect(LIST_SCREENS.milestones.nested?.lateFields).toContain('tasks');
  });

  it('у вехи есть время правки (changed_at) — «Изменены» доступно', () => {
    expect(ms('M1', []).updated_at).toBe('2026-11-13T15:30:50Z');
  });

  it('с краской продукта нет дубля «Продукт»/«Продукты» — ни в колонках, ни в фильтрах, ни в разрезах', () => {
    const painted = withProductColumn(cfg, 'Продукт');
    const list = painted.list!;
    expect(list.columns).toContain(PRODUCT_COLUMN);
    expect(list.columns).not.toContain('products');
    expect(list.filters).not.toContain('fields.products');
    expect(list.groupings).not.toContain('fields.products');
  });

  it('без краски (срез продуктов не пришёл) своя колонка «Продукты» остаётся', () => {
    expect(cfg.list?.columns).toContain('products');
  });
});
