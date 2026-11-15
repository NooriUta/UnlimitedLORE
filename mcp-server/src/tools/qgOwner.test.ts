import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// ADR-LORE-053-D7 (SPRINT_QG_REBUILD/QG-04, QG-09): бэкенд принимает у гейта
// project (проект-владелец, ребро BELONGS_TO_PROJECT) и retired_reason, а схема
// qg_new их не объявляла — через MCP гейт нельзя было ни сделать active
// (нужен владелец), ни отменить (нужна причина). Сторож: оба поля в схеме и в теле.

const sent: { path: string; body: Record<string, unknown> }[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

describe('qg_new: владелец и причина отмены доходят до бэкенда', () => {
  const tool = collect(registerLoreWrite).find((t) => t.name === 'qg_new');

  it('схема объявляет project и retired_reason', () => {
    expect(tool).toBeDefined();
    expect(Object.keys(tool!.schema)).toEqual(expect.arrayContaining(['project', 'retired_reason']));
  });

  it('project и retired_reason уходят в тело /lore/quality-gate', async () => {
    sent.length = 0;
    await tool!.handler({ qg_id: 'QG-X', name: 'x', status: 'retired', project: 'NooriUta/UnlimitedLORE', retired_reason: 'отмерла' });
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toBe('/lore/quality-gate');
    expect(sent[0].body).toMatchObject({ project: 'NooriUta/UnlimitedLORE', retired_reason: 'отмерла', status: 'retired' });
  });
});
