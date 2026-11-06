import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH, A1–A2 (06.11.2026).
//
// Случай: сессия miniLORE, разобрав четыре устаревших вопроса, поставила им
// `dropped`, потому что question_set не принимал `closed` — схема отбивала его
// голым «Invalid enum value», без слова о механике. Доказательства ушли в
// заметки, где их не найти. `dropped` = «решили не отвечать»; «устарел, и вот
// доказательство» = `closed` через решение и связь answers.
//
// Правило: на попытку закрыть руками — отказ ДО записи, который сам говорит,
// что делать, и разводит closed и dropped.

const sent: { path: string; body: unknown }[] = [];
vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

describe('закрыть вопрос руками нельзя, но отказ объясняет, как надо', () => {
  const tools = collect(registerLoreWrite);
  const byName = (n: string) => tools.find(t => t.name === n)!;
  const text = (r: unknown) => JSON.stringify(r);

  for (const name of ['question_set', 'question_new']) {
    it(`${name}: status=closed проходит схему и получает инструкцию, а не ошибку валидации`, async () => {
      sent.length = 0;
      const status = (byName(name).schema as Record<string, { safeParse: (v: unknown) => { success: boolean } }>).status;
      expect(status.safeParse('closed').success).toBe(true);
      const r = await byName(name).handler({ question_id: 'Q-X', status: 'closed' });
      expect(sent, 'до бэкенда запись не доходит').toHaveLength(0);
      const t = text(r);
      expect(t).toContain('question_link');
      expect(t).toContain('answers');
      expect(t).toContain('dropped');      // разводит два исхода
      expect(t).toMatch(/нескольк|several/); // одно решение закрывает много вопросов
    });
  }

  it('обычная правка статуса по-прежнему доходит до бэкенда (положительный контроль)', async () => {
    sent.length = 0;
    await byName('question_set').handler({ question_id: 'Q-X', status: 'open' });
    expect(sent).toHaveLength(1);
  });

  it('описание инструмента разводит closed и dropped', () => {
    const d = byName('question_set').description;
    expect(d).toContain('dropped');
    expect(d).toMatch(/answers/);
  });
});
