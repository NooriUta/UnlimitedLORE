import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { collect } from './writeToolHarness.js';

// SPRINT_QG_REBUILD/QG-07 — честный baseline. Метрика прогона несёт basis — отпечаток знаменателя
// (состав выборки, фильтр, LIMIT); экран QG сравнивает с прошлым прогоном только при той же базе.
// Повод: task_done_pct_avg «упала» 99.1% → 78.1% — было LIMIT 15 спринтов, стало 357 групп.
// zod по умолчанию молча срезает незнакомые ключи — без поля в схеме база терялась бы по дороге.

const calls: { path: string; body: unknown }[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown) => {
    calls.push({ path, body });
    return { ok: true };
  }),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');
const qgRunLog = () => collect(registerLoreWrite).find((t) => t.name === 'qg_run_log')!;

describe('qg_run_log: база метрики доходит до сервера', () => {
  beforeEach(() => { calls.length = 0; });

  const args = {
    routine_name: 'qg-x', run_date: '2026-11-25', status: 'WARN',
    metrics: [{ key: 'task_done_pct_avg', value: 78.1, unit: 'pct', status: 'FAIL', basis: 'groups=357' }],
  };

  it('схема не срезает basis', () => {
    const r = z.object(qgRunLog().schema).safeParse(args);
    expect(r.success).toBe(true);
    expect((r as { data: typeof args }).data.metrics[0].basis).toBe('groups=357');
  });

  it('basis уходит телом в /lore/qg/run', async () => {
    const parsed = z.object(qgRunLog().schema).parse(args);
    await qgRunLog().handler(parsed);
    expect(calls[0].path).toBe('/lore/qg/run');
    expect(calls[0].body).toMatchObject({ metrics: [{ key: 'task_done_pct_avg', basis: 'groups=357' }] });
  });

  it('описание объясняет, зачем база', () => {
    const metrics = qgRunLog().schema.metrics as z.ZodOptional<z.ZodArray<z.ZodObject<z.ZodRawShape>>>;
    const shape = metrics.unwrap().element.shape;
    expect(shape.basis.description).toMatch(/denominator/i);
  });
});
