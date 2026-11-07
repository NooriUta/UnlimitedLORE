import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_UXR_S2_GRAPH_MEMORY/S2-09: «было» (expected) доходит до бэкенда, а 409 CONFLICT
// приходит понятным сообщением, а не голым кодом.
const sent: { path: string; body: Record<string, unknown> }[] = [];
let fail: Error | undefined;
vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>) => {
    sent.push({ path, body });
    if (fail) throw fail;
    return { ok: true };
  }),
  loreGet: vi.fn(async () => ({ rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));
const { registerLoreWrite, CONFLICT_HINT } = await import('./loreWrite.js');

describe('оптимистическая блокировка SCD2 (S2-09)', () => {
  const tools = collect(registerLoreWrite);
  const byName = (n: string) => tools.find(t => t.name === n)!;

  it('status_set передаёт expected, а без него ключа нет вовсе (форма тела не меняется)', async () => {
    fail = undefined; sent.length = 0;
    await byName('status_set').handler({ entity_type: 'task', id: 'S/T', status: 'done', expected: 'active' });
    expect(sent[0].body).toMatchObject({ expected: 'active' });
    await byName('status_set').handler({ entity_type: 'task', id: 'S/T', status: 'done' });
    expect(sent[1].body).not.toHaveProperty('expected');
  });

  it('sprint_plan_set передаёт expected по полям плана', async () => {
    fail = undefined; sent.length = 0;
    await byName('sprint_plan_set').handler({ sprint_id: 'S', priority: 'low', expected: { priority: 'high' } });
    expect(sent[0].path).toBe('/lore/sprint/plan');
    expect(sent[0].body).toMatchObject({ expected: { priority: 'high' } });
  });

  it('task_set передаёт expected — одиночный и пакетный режим', async () => {
    fail = undefined; sent.length = 0;
    await byName('task_set').handler({ task_uid: 'S/T', title: 't', expected: { note_md: 'n1' } });
    expect(sent[0].body).toMatchObject({ expected: { note_md: 'n1' } });
    await byName('task_set').handler({ tasks: [{ task_uid: 'S/T', title: 't', expected: { status: 'active' } }] });
    expect((sent[1].body as unknown as Record<string, unknown>[])[0]).toMatchObject({ expected: { status: 'active' } });
  });

  it('409 CONFLICT — ошибка с подсказкой, что делать', async () => {
    fail = new Error('POST /lore/status → 409 {"error":"CONFLICT","detail":"x","current":{"status":"done"}}');
    const res = await byName('status_set').handler({ entity_type: 'task', id: 'S/T', status: 'active', expected: 'todo' }) as
      { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(CONFLICT_HINT);
    expect(res.content[0].text).toContain('"current"');
  });

  it('прочие ошибки подсказку не получают (положительный контроль)', async () => {
    fail = new Error('POST /lore/status → 404 {"error":"NOT_FOUND"}');
    const res = await byName('status_set').handler({ entity_type: 'task', id: 'S/T', status: 'active' }) as
      { content: { text: string }[] };
    expect(res.content[0].text).not.toContain(CONFLICT_HINT);
  });
});
