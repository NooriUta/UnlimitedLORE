import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// Владелец 05.11.2026: «опять сироты» — на ленте день за днём решения, спеки и
// записи технологий «без проекта». Причина: LORE_ACTIVE_PROJECT не задан ни в
// одном конфиге MCP, а без него создающие инструменты молча писали сущность без
// ребра BELONGS_TO_PROJECT (ok:true). Теперь: нет ни project, ни проекта сессии —
// вызов отклоняется ДО записи, с подсказкой, что передать.

const sent: { path: string; body: unknown }[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');
const tools = collect(registerLoreWrite);
const tool = (name: string) => {
  const t = tools.find(x => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const isError = (r: unknown) => (r as { isError?: boolean }).isError === true;

const MINIMAL: Record<string, Record<string, unknown>> = {
  decision_new: { decision_id: 'D-X', title: 't' },
  adr_new:      { adr_id: 'ADR-X', title: 't' },
  spec_new:     { spec_id: 'SPEC-X', title: 't' },
  doc_new:      { doc_id: 'doc_x', title: 't' },
  runbook_new:  { runbook_id: 'RB-X', name: 'n' },
  question_new: { question_id: 'Q-X', title: 't' },
  uc_new:       { uc_id: 'UC-X', title: 't' },
  feature_new:  { feature_id: 'F-X', title: 't' },
  tech_set:     { component_id: 'YGG', tech_name: 'ArcadeDB', version: '26.11.1' },
};

describe('создание без проекта отклоняется (сироты на ленте)', () => {
  beforeEach(() => { sent.length = 0; });

  for (const [name, args] of Object.entries(MINIMAL)) {
    it(`${name} без project и без LORE_ACTIVE_PROJECT — отказ до записи`, async () => {
      const r = await tool(name).handler(args);
      expect(isError(r), text(r)).toBe(true);
      expect(text(r)).toMatch(/project/);
      expect(sent).toEqual([]);           // ничего не записано
    });

    it(`${name} с project — пишет и ставит ребро проекта`, async () => {
      const r = await tool(name).handler({ ...args, project: 'org/a' });
      expect(isError(r), text(r)).toBe(false);
      expect(JSON.stringify(sent)).toContain('org/a');
    });
  }

  it('решение с родительским ADR — проект приходит через ADR, отказа нет', async () => {
    const r = await tool('decision_new').handler({ decision_id: 'D-X', title: 't', adr_id: 'ADR-LORE-001' });
    expect(isError(r), text(r)).toBe(false);
    expect(sent.length).toBe(1);
  });
});
