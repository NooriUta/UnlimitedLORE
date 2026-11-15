import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_WORK_ANY_KIND/WK-BATCH-EVIDENCE. 14.11.2026: пачка статусов не несла ни
// причины, ни доказательства. 31 задача → blocked упала целиком (у blocked причина
// обязательна), а 125 задач UAT → done по слову владелицы пришлось ставить по одной.
//
// Правило, а не кейс: всё, что status_set говорит о смене статуса (кроме адреса одной
// записи и «было» для блокировки), status_set_batch принимает и доносит до бэкенда.

const sent: { path: string; body: unknown }[] = [];
vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

// id — адрес одной записи (у пачки — ids); expected — «было» одной записи (S2-09);
// stage/waiting_for — стадия приёмки одной задачи, пачкой её не ставят.
const SINGLE_ONLY = new Set(['id', 'expected', 'stage', 'waiting_for']);

describe('status_set_batch несёт то же, что status_set', () => {
  const tools = collect(registerLoreWrite);
  const byName = (n: string) => tools.find(t => t.name === n);

  it('схема пачки — надмножество полей смены статуса из status_set', () => {
    const one = byName('status_set');
    const batch = byName('status_set_batch');
    expect(one && batch, 'оба инструмента найдены').toBeTruthy();
    const fields = Object.keys(one!.schema).filter(k => !SINGLE_ONLY.has(k));
    expect(fields).toContain('reason');          // положительный контроль: сравниваем не пустоту
    expect(fields).toContain('evidence_type');
    expect(fields.filter(k => !(k in batch!.schema))).toEqual([]);
  });

  it('reason и доказательство из пачки доходят до тела запроса', async () => {
    sent.length = 0;
    await byName('status_set_batch')!.handler({
      entity_type: 'task', ids: ['S/T-1', 'S/T-2'], status: 'blocked',
      reason: 'ждёт владелицу', evidence_type: 'owner_word', evidence_ref: '14.11.2026 «стоп»',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toBe('/lore/status/batch');
    expect(sent[0].body).toMatchObject({
      entity_type: 'task', ids: ['S/T-1', 'S/T-2'], status: 'blocked',
      reason: 'ждёт владелицу', evidence_type: 'owner_word', evidence_ref: '14.11.2026 «стоп»',
    });
  });

  it('без причины — поле не выдумывается', async () => {
    sent.length = 0;
    await byName('status_set_batch')!.handler({ entity_type: 'task', ids: ['S/T-1'], status: 'active' });
    const body = sent[0].body as Record<string, unknown>;
    expect(body.reason ?? null).toBeNull();
    expect('evidence_type' in body).toBe(false);
  });
});
