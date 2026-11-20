import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 (владелица 20.11.2026 «треки б»): трек спринта — ребро ON_TRACK спринт → трек,
// а не строка версии. Запись трека агентом — тем же sprint_plan_set (/lore/sprint/plan): на базе 1.18 сервер ставит
// ребро и закрывает прежнее. Описание инструмента обязано говорить правду: где живёт трек, как его снять, откуда коды.
const sent: { path: string; body: Record<string, unknown> }[] = [];
vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async () => ({ rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));
const { registerLoreWrite } = await import('./loreWrite.js');

describe('sprint_plan_set — трек спринта по ребру ON_TRACK (MDL-13)', () => {
  const tool = collect(registerLoreWrite).find(t => t.name === 'sprint_plan_set')!;

  it('описание говорит правду: трек — ребро ON_TRACK к записи трека, смена закрывает прежнее, пусто — снять', () => {
    const d = tool.description ?? '';
    expect(d).toMatch(/ON_TRACK/);
    expect(d).toMatch(/track_options/);
    expect(d).toMatch(/closes the previous/i);
    expect(d).toMatch(/"" removes the track/);
    const trackDesc = (tool.schema.track_id as unknown as { description?: string }).description ?? '';
    expect(trackDesc).toMatch(/track_options/);
  });

  it('трек уходит в /lore/sprint/plan как track_id; пустая строка — снять трек (не «не менять»)', async () => {
    sent.length = 0;
    await tool.handler({ sprint_id: 'SPRINT_HOUND_S3', track_id: '2' });
    expect(sent[0]).toEqual({ path: '/lore/sprint/plan', body: expect.objectContaining({ sprint_id: 'SPRINT_HOUND_S3', track_id: '2' }) });
    await tool.handler({ sprint_id: 'SPRINT_HOUND_S3', track_id: '' });
    expect(sent[1].body.track_id).toBe('');
  });
});
