import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH (случай 13.11, ADR-LORE-052): entity_upsert type=runbook
// fields={status:"deprecated"} ответил ok:true, а поле молча отброшено — у runbook статуса нет.
// Правило ADR-LORE-043: ответ называет произошедшее. Поле, которого нет в схеме заменённого
// инструмента, перечисляется в ignored_fields, а не теряется молча.

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async () => ({ ok: true, id: 'R-1' })),
  loreGet: vi.fn(async () => ({ hits: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');
const tools = collect(registerLoreWrite);
const upsert = tools.find(t => t.name === 'entity_upsert')!;
const body = async (args: Record<string, unknown>) =>
  JSON.parse((await upsert.handler(args) as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;

describe('entity_upsert: неизвестные поля называются, а не теряются', () => {
  it('runbook.status — нет такого поля: ignored_fields', async () => {
    const r = await body({ type: 'runbook', id: 'RUNBOOK-X', fields: { name: 'x', status: 'deprecated', project: 'NooriUta/UnlimitedLORE' } });
    expect(r.ignored_fields).toEqual(['status']);
    expect(String(r.ignored_hint)).toContain('status');
  });

  it('положительный контроль: только известные поля — ignored_fields нет', async () => {
    const r = await body({ type: 'runbook', id: 'RUNBOOK-X', fields: { name: 'x', content_md: 'y', project: 'NooriUta/UnlimitedLORE' } });
    expect(r.ignored_fields).toBeUndefined();
  });

  it('dict.kind — известное поле после WK-01, human_approval — служебное', async () => {
    const r = await body({ type: 'dict', fields: { dict_type: 'product', code: 'HARPA', kind: 'service', human_approval: 'owner: chat' } });
    expect(r.ignored_fields).toBeUndefined();
  });
});

describe('entity_upsert: поле, которое build переводит сам, не числится ignored', () => {
  it('sprint.git_project', async () => {
    const r = await body({ type: 'sprint', id: 'SPRINT_X', fields: { name: 'x', git_project: 'NooriUta/UnlimitedLORE' } });
    expect(r.ignored_fields).toBeUndefined();
  });
});
