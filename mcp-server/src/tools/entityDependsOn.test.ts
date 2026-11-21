import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 — одна связь «зависит от» (DEPENDS_ON) между задачей, фазой, спринтом
// и вехой через entity_link rel="depends_on": один путь /lore/dep, вид и причина — fields.kind / fields.reason,
// тип другого конца — fields.target_type (не задан — сервер ищет по ключу). Неизвестный вид проверяет сервер
// (422 со справочником) — MCP вид не подменяет и не отсекает.

type Call = { path: string; body: Record<string, unknown> };
const calls: Call[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>) => {
    calls.push({ path, body });
    if (body.kind === 'blocker') throw new Error('POST /lore/dep → 422 {"error":"UNKNOWN_KIND","allowed":["hard","soft","gate","informs"]}');
    if (body.to_id === 'CYCLE') throw new Error('POST /lore/dep → 409 {"error":"CYCLE","cycle":["task:A","task:CYCLE","task:A"]}');
    return { ok: true, outcome: 'created' };
  }),
  loreGet: vi.fn(async () => ({ hits: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');
const tools = collect(registerLoreWrite);
const link = tools.find(t => t.name === 'entity_link')!;

async function run(args: Record<string, unknown>) {
  calls.length = 0;
  const r = await link.handler(args);
  return { r: r as { isError?: boolean; content: { text: string }[] }, calls: calls.map(c => ({ ...c })) };
}

describe('entity_link rel=depends_on — задача, фаза, спринт, веха', () => {
  it.each([
    ['task', 'SPRINT_A/T1'],
    ['phase', 'SPRINT_B/PHASE_1'],
    ['sprint', 'SPRINT_A'],
    ['milestone', 'M-1'],
  ])('%s идёт путём /lore/dep с видом, причиной и типом цели', async (type, id) => {
    const { r, calls: c } = await run({ type, id, rel: 'depends_on', target_id: 'SPRINT_C',
      fields: { kind: 'hard', reason: 'ждём схему', target_type: 'sprint' } });
    expect(r.isError).not.toBe(true);
    expect(c).toEqual([{ path: '/lore/dep', body: {
      from_type: type, from_id: id, to_type: 'sprint', to_id: 'SPRINT_C', kind: 'hard', reason: 'ждём схему', action: 'add',
    } }]);
  });

  it('без вида и типа цели — сервер решает сам (вид по умолчанию, тип по ключу)', async () => {
    const { calls: c } = await run({ type: 'task', id: 'A', rel: 'depends_on', target_id: 'M-1' });
    expect(c[0].body).toEqual({ from_type: 'task', from_id: 'A', to_type: null, to_id: 'M-1', kind: null, reason: null, action: 'add' });
  });

  it('снятие — action remove тем же путём', async () => {
    const { calls: c } = await run({ type: 'milestone', id: 'M-1', rel: 'depends_on', target_id: 'SPRINT_A', action: 'remove' });
    expect(c[0].body.action).toBe('remove');
  });

  it('без target_id — отказ до сети', async () => {
    const { r, calls: c } = await run({ type: 'phase', id: 'SPRINT_B/PHASE_1', rel: 'depends_on' });
    expect(r.isError).toBe(true);
    expect(c).toHaveLength(0);
  });

  it('неизвестный вид и цикл — отказ сервера доходит как есть (422, 409 с путём)', async () => {
    const bad = await run({ type: 'task', id: 'A', rel: 'depends_on', target_id: 'B', fields: { kind: 'blocker' } });
    expect(bad.r.isError).toBe(true);
    expect(bad.r.content[0].text).toContain('422');
    expect(bad.r.content[0].text).toContain('UNKNOWN_KIND');
    const cyc = await run({ type: 'task', id: 'A', rel: 'depends_on', target_id: 'CYCLE' });
    expect(cyc.r.isError).toBe(true);
    expect(cyc.r.content[0].text).toContain('409');
    expect(cyc.r.content[0].text).toContain('task:A');
  });

  it('прежний rel=dep у спринта остаётся (тот же путь sprint/dep)', async () => {
    const { calls: c } = await run({ type: 'sprint', id: 'S', rel: 'dep', target_id: 'S2', fields: { kind: 'gate' } });
    expect(c[0].path).toBe('/lore/sprint/dep');
  });
});
