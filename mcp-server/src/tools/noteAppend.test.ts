import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_MEASURE_TRUTH/MT-NOTE-APPEND: дописывание вместо перезаписи целиком.
const sent: { path: string; body: Record<string, unknown> }[] = [];
vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async () => ({ rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));
const { registerLoreWrite } = await import('./loreWrite.js');

describe('дописывание доходит до бэкенда', () => {
  const tools = collect(registerLoreWrite);
  const byName = (n: string) => tools.find(t => t.name === n)!;

  it('task_set note_append — одиночный режим', async () => {
    sent.length = 0;
    await byName('task_set').handler({ task_uid: 'S/T', title: 't', note_append: 'B' });
    expect(sent[0].path).toBe('/lore/task/edit');
    expect(sent[0].body).toMatchObject({ note_append: 'B', note_md: null });
  });

  it('task_set note_append — пакетный режим', async () => {
    sent.length = 0;
    await byName('task_set').handler({ tasks: [{ task_uid: 'S/T', title: 't', note_append: 'B' }] });
    expect((sent[0].body as unknown as Record<string, unknown>[])[0]).toMatchObject({ note_append: 'B' });
  });

  it('sprint_set context_append и outcome_append', async () => {
    sent.length = 0;
    await byName('sprint_set').handler({ sprint_id: 'S', context_append: 'C', outcome_append: 'O' });
    expect(sent[0].path).toBe('/lore/sprint/update');
    expect(sent[0].body).toMatchObject({ context_append: 'C', outcome_append: 'O', context_md: null, outcome_md: null });
  });

  it('описания называют разницу: целиком или дописать', () => {
    expect(String(byName('task_set').description)).toContain('note_append');
  });
});
