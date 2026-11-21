import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_WORK_ANY_KIND/WK-01 (ADR-LORE-044, решение владелицы 19.11.2026): вид продукта — НАБОР
// tech | service, у продукта одно значение или оба; пустой набор нельзя. Смена вида у существующей
// статьи — правка с причиной (reason уходит в версию истории). Правка — существующей дверью dict_set
// (и entity_upsert type=dict), второго инструмента нет.

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
const dictSet = () => collect(registerLoreWrite).find((t) => t.name === 'dict_set')!;
const parse = (a: Record<string, unknown>) => z.object(dictSet().schema).safeParse(a);

describe('dict_set: вид продукта — набор, смена вида — с причиной', () => {
  beforeEach(() => { calls.length = 0; });

  it('схема принимает набор из одного и из двух видов, строку (qg_type) — тоже; пустой набор — нет', () => {
    expect(parse({ dict_type: 'product', code: 'HARPA', kind: ['tech', 'service'] }).success).toBe(true);
    expect(parse({ dict_type: 'product', code: 'FREYJA', kind: ['service'] }).success).toBe(true);
    expect(parse({ dict_type: 'qg_type', code: 'U', kind: 'universal' }).success).toBe(true);
    expect(parse({ dict_type: 'product', code: 'X', kind: [] }).success).toBe(false);
  });

  it('набор и причина доходят до сервера телом', async () => {
    await dictSet().handler({ dict_type: 'product', code: 'HARPA', kind: ['tech', 'service'], reason: 'HARPA продаёт услуги' });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/lore/dict/entry');
    expect(calls[0].body).toMatchObject({ dict_type: 'product', code: 'HARPA', kind: ['tech', 'service'], reason: 'HARPA продаёт услуги' });
  });

  it('описание правдиво: вид продукта — набор, смена вида требует reason', () => {
    const s = dictSet().schema;
    expect(s.kind.description).toMatch(/SET/);
    expect(s.kind.description).toMatch(/requires reason/);
    expect(s.reason.description).toMatch(/REQUIRED when the kind/);
  });
});
