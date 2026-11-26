import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_KNOW_REGISTRY/KREG-11 — task_link rel="dep": DEPENDS_ON задача→задача через выделенный
// путь /lore/task/dep (по образцу sprint/dep, MDL-13 внутри: вид из справочника dependency_kind,
// причина обязательна у новой связи, цикл — 409 с цепочкой). MCP вид не подменяет и не отсекает —
// неизвестный вид и цикл отвечает сервер.

type Call = { path: string; body: Record<string, unknown> };
const calls: Call[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>) => {
    calls.push({ path, body });
    if (body.kind === 'blocker') throw new Error('POST /lore/task/dep → 422 {"error":"UNKNOWN_KIND","allowed":["blocks","waits","soft","gate","informs","relates"]}');
    if (body.to_task === 'SPRINT_A/T-CYCLE') throw new Error('POST /lore/task/dep → 409 {"error":"CYCLE","cycle":["task:SPRINT_A/T2","task:SPRINT_A/T-CYCLE","task:SPRINT_A/T2"]}');
    return { ok: true, outcome: body.action === 'remove' ? 'deleted' : 'created' };
  }),
  loreGet: vi.fn(async () => ({ hits: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');
const tools = collect(registerLoreWrite);
const taskLink = tools.find(t => t.name === 'task_link')!;
const entityLink = tools.find(t => t.name === 'entity_link')!;

async function run(tool: typeof taskLink, args: Record<string, unknown>) {
  calls.length = 0;
  const r = await tool.handler(args);
  return { r: r as { isError?: boolean; content: { text: string }[] }, calls: calls.map(c => ({ ...c })) };
}

describe('task_link rel="dep" — DEPENDS_ON задача→задача (KREG-11)', () => {
  it('ставит зависимость путём /lore/task/dep с видом и причиной', async () => {
    const { r, calls: c } = await run(taskLink, { task_uid: 'SPRINT_A/T1', rel: 'dep',
      target_id: 'SPRINT_A/T2', kind: 'blocks', reason: 'ждём схему' });
    expect(r.isError).not.toBe(true);
    expect(c).toEqual([{ path: '/lore/task/dep', body: {
      from_task: 'SPRINT_A/T1', to_task: 'SPRINT_A/T2', kind: 'blocks', reason: 'ждём схему', action: 'add',
    } }]);
  });

  it('вид по умолчанию — soft, как у спринтов', async () => {
    const { calls: c } = await run(taskLink, { task_uid: 'SPRINT_A/T1', rel: 'dep',
      target_id: 'SPRINT_A/T2', reason: 'координация' });
    expect(c[0].body).toEqual({ from_task: 'SPRINT_A/T1', to_task: 'SPRINT_A/T2',
      kind: 'soft', reason: 'координация', action: 'add' });
  });

  it('цикл отбивается сервером с цепочкой — отказ доходит как есть (409)', async () => {
    const { r, calls: c } = await run(taskLink, { task_uid: 'SPRINT_A/T2', rel: 'dep',
      target_id: 'SPRINT_A/T-CYCLE', kind: 'soft', reason: 'замкнёт круг' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('409');
    expect(r.content[0].text).toContain('CYCLE');
    expect(r.content[0].text).toContain('task:SPRINT_A/T2');
  });

  it('неизвестный вид — 422 сервера доходит как есть', async () => {
    const { r } = await run(taskLink, { task_uid: 'SPRINT_A/T1', rel: 'dep',
      target_id: 'SPRINT_A/T2', kind: 'blocker', reason: 'x' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('422');
    expect(r.content[0].text).toContain('UNKNOWN_KIND');
  });

  it('unlink: action=remove снимает зависимость тем же путём', async () => {
    const { r, calls: c } = await run(taskLink, { task_uid: 'SPRINT_A/T1', rel: 'dep',
      target_id: 'SPRINT_A/T2', action: 'remove' });
    expect(r.isError).not.toBe(true);
    expect(c[0].path).toBe('/lore/task/dep');
    expect(c[0].body.action).toBe('remove');
    expect(JSON.parse(c[0].body ? (r.content[0].text) : '{}').outcome).toBe('deleted');
  });

  it('без target_id — отказ до сети', async () => {
    const { r, calls: c } = await run(taskLink, { task_uid: 'SPRINT_A/T1', rel: 'dep' });
    expect(r.isError).toBe(true);
    expect(c).toHaveLength(0);
  });
});

describe('entity_link type=task rel="dep" — тот же выделенный путь (KREG-11)', () => {
  it('идёт в /lore/task/dep, а не в универсальный /lore/dep', async () => {
    const { r, calls: c } = await run(entityLink, { type: 'task', id: 'SPRINT_A/T1', rel: 'dep',
      target_id: 'SPRINT_A/T2', fields: { kind: 'gate', reason: 'go/no-go' } });
    expect(r.isError).not.toBe(true);
    expect(c).toEqual([{ path: '/lore/task/dep', body: {
      from_task: 'SPRINT_A/T1', to_task: 'SPRINT_A/T2', kind: 'gate', reason: 'go/no-go', action: 'add',
    } }]);
  });

  it('rel=depends_on остаётся универсальным путём /lore/dep (MDL-13 не тронут)', async () => {
    const { calls: c } = await run(entityLink, { type: 'task', id: 'SPRINT_A/T1', rel: 'depends_on',
      target_id: 'M-1', fields: { kind: 'soft', reason: 'r' } });
    expect(c[0].path).toBe('/lore/dep');
  });

  it('снятие — action remove тем же путём', async () => {
    const { calls: c } = await run(entityLink, { type: 'task', id: 'SPRINT_A/T1', rel: 'dep',
      target_id: 'SPRINT_A/T2', action: 'remove', fields: { kind: 'soft' } });
    expect(c[0].path).toBe('/lore/task/dep');
    expect(c[0].body.action).toBe('remove');
  });

  it('без target_id — отказ до сети', async () => {
    const { r, calls: c } = await run(entityLink, { type: 'task', id: 'SPRINT_A/T1', rel: 'dep' });
    expect(r.isError).toBe(true);
    expect(c).toHaveLength(0);
  });
});
