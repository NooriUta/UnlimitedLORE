import { describe, expect, it, vi } from 'vitest';

// D-2026-MINILORE-OWNER-ANSWERS-06-11 п.3: task_link rel="pr" → CLOSED_BY.
const sent: { path: string; body: Record<string, unknown> }[] = [];
vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: 'NooriUta/UnlimitedLORE',
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>) => { sent.push({ path, body }); return { ok: true, outcome: 'created' }; }),
  loreGet: vi.fn(async () => ({ rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { collect } = await import('./writeToolHarness.js');
const { registerLoreWrite } = await import('./loreWrite.js');

describe('task_link rel="pr" ведёт задачу к закрывшему её PR', () => {
  const tl = collect(registerLoreWrite).find(t => t.name === 'task_link')!;

  it('полный адрес PR уходит как есть', async () => {
    sent.length = 0;
    await tl.handler({ task_uid: 'S/T-1', rel: 'pr', target_id: 'AIDA/volva#38' });
    expect(sent[0].path).toBe('/lore/task/pr');
    expect(sent[0].body).toMatchObject({ task_uid: 'S/T-1', pr: 'AIDA/volva#38', action: 'add' });
  });

  it('голый номер берёт проект сессии, если явный не передан', async () => {
    sent.length = 0;
    await tl.handler({ task_uid: 'S/T-1', rel: 'pr', target_id: '#801' });
    expect(sent[0].body).toMatchObject({ pr: '#801', project: 'NooriUta/UnlimitedLORE' });
  });

  it('без target_id — отказ до записи', async () => {
    sent.length = 0;
    const r = await tl.handler({ task_uid: 'S/T-1', rel: 'pr' });
    expect(sent).toHaveLength(0);
    expect(JSON.stringify(r)).toContain('owner/repo#N');
  });
});
