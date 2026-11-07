import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH, A9 (06.11.2026): дубли вопросов не
// ловились при заведении — видно глазами: Q-HND030-GRAN и Q-HND030-GRANULARITY,
// Q-HND030-PATH-STORAGE и Q-HND030-PATHSTORE. Правило: question_new после записи
// ищет похожие по заголовку и показывает их в ответе — решать человеку/агенту,
// но видеть кандидатов он обязан сразу, а не на ревизии через месяц.

const gets: { path: string; params: Record<string, string> }[] = [];
vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: 'NooriUta/UnlimitedLORE',
  lorePost: vi.fn(async () => ({ ok: true })),
  loreGet: vi.fn(async (path: string, params: Record<string, string>) => {
    gets.push({ path, params });
    if (path === '/lore/search') return {
      hits: [
        { type: 'question', ref_id: 'Q-HND030-GRAN', title: 'Гранулярность пути', score: 0.9 },
        { type: 'question', ref_id: 'Q-HND030-GRANULARITY', title: 'Гранулярность пути lineage', score: 0.8 },
      ],
    };
    return { ok: true, rows: [] };
  }),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

describe('question_new показывает похожие вопросы', () => {
  const tools = collect(registerLoreWrite);
  const qn = tools.find(t => t.name === 'question_new')!;

  it('ищет по заголовку среди вопросов и отдаёт кандидатов без самого себя', async () => {
    gets.length = 0;
    const r = await qn.handler({ question_id: 'Q-HND030-GRANULARITY', title: 'Гранулярность пути lineage' });
    const search = gets.find(g => g.path === '/lore/search');
    expect(search, 'поиск вызван').toBeTruthy();
    expect(search!.params.types).toBe('question');
    expect(search!.params.q).toContain('Гранулярность');
    const body = JSON.parse((r as { content: { text: string }[] }).content[0].text);
    const ids = (body.similar_questions as { ref_id: string }[]).map(h => h.ref_id);
    expect(ids).toContain('Q-HND030-GRAN');            // кандидат на месте
    expect(ids).not.toContain('Q-HND030-GRANULARITY'); // себя не предлагает
    expect(body.project_linked).toBe(true);              // привязка проекта не потерялась
  });

  it('без заголовка не ищет — правка поля не должна шуметь кандидатами', async () => {
    gets.length = 0;
    await qn.handler({ question_id: 'Q-X', owner: 'omiloreadmin' });
    expect(gets.find(g => g.path === '/lore/search')).toBeUndefined();
  });
});
