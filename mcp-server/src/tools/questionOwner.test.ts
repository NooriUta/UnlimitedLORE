import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH A6 (решение владелицы 19.11.2026, «1а»).
//
// Ответственный вопроса — ребро ANSWERABLE_BY к человеку или агенту реестра, а не свободный текст:
// пять написаний владелицы сводятся к omiloreadmin, незнакомое значение — 422 с причиной, при закрытии
// вопроса решением (question_link rel=answers) ответственным становится автор решения.
//
// Прежнее описание параметра owner — «who owns getting the answer» — молчало о том, что значение
// должно быть записью реестра, и звало писать прозу («серверная половина шлюза»). Описание без лжи
// обязано назвать: что принимается, что будет с незнакомым и что сделает answers.

const sent: { path: string; body: unknown }[] = [];
vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

const tools = collect(registerLoreWrite);
const byName = (n: string) => tools.find(t => t.name === n)!;
const ownerDescription = (n: string) =>
  ((byName(n).schema as Record<string, { description?: string }>).owner).description ?? '';

describe('owner у question_new / question_set — ребро к записи реестра, описание без лжи', () => {
  for (const name of ['question_new', 'question_set']) {
    it(`${name}: описание owner называет реестр, ребро, отказ 422 и перевод на автора решения`, () => {
      const d = ownerDescription(name);
      expect(d).toMatch(/registry|реестр/);
      expect(d).toContain('ANSWERABLE_BY');
      expect(d).toContain('422');
      expect(d).toContain('omiloreadmin');
      expect(d).toMatch(/answers/);
      expect(d).not.toMatch(/free text allowed|any text/i);
    });

    it(`${name}: owner доходит до бэкенда как есть — сопоставляет сервер, не MCP`, async () => {
      sent.length = 0;
      // question_new требует проект (projectRequired) — без него запись не уходит вовсе
      await byName(name).handler({ question_id: 'Q-X', owner: 'владелица', project: 'NooriUta/UnlimitedLORE' });
      const q = sent.filter(s => s.path === '/lore/question');
      expect(q).toHaveLength(1);
      expect((q[0].body as { owner: string }).owner).toBe('владелица');
    });
  }

  it('question_link: описание rel=answers говорит, что ответственным станет автор решения', () => {
    expect(byName('question_link').description).toMatch(/author|автор/);
  });
});
