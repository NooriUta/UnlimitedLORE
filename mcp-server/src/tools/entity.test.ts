import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_MCP_V2/MCPV2-3 — тесты обобщённой CRUD-консолидации (entity.ts).
// Ядро — ПАРИТЕТ с перекрытыми инструментами: тот же path и те же значения
// переданных полей уходят в lorePost, что и у старого per-entity инструмента
// (старые тела дополнительно заливают непереданные поля null'ами — бэкенд
// читает null и absent одинаково, поэтому сравнение — подмножество по ключам).

type Call = { path: string; body: Record<string, unknown>; headers?: Record<string, string> };
const calls: Call[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>, headers?: Record<string, string>) => {
    calls.push({ path, body, headers });
    return { ok: true, id: 'ENTITY-TEST' };
  }),
  loreGet: vi.fn(async () => ({ hits: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');
const { LEGACY_CRUD_TOOLS, legacySurfaceGate } = await import('./entity.js');
const { withStrictTools } = await import('./strictTool.js');
const { corePermission, fullPermission, gateFor, permissionForProfile } = await import('../profile.js');

const tools = collect(registerLoreWrite);
const byName = Object.fromEntries(tools.map(t => [t.name, t]));

async function run(name: string, args: Record<string, unknown>): Promise<Call[]> {
  calls.length = 0;
  await byName[name].handler(args);
  return calls.map(c => ({ ...c }));
}

/** Вызвать old и new с эквивалентными args; пути обязаны совпасть, значения переданных полей — тоже. */
async function parity(
  oldName: string, oldArgs: Record<string, unknown>,
  newName: string, newArgs: Record<string, unknown>,
): Promise<void> {
  const oldCalls = await run(oldName, oldArgs);
  const newCalls = await run(newName, newArgs);
  expect(`${newName} vs ${oldName}: ${JSON.stringify(newCalls.map(c => c.path))}`)
    .toBe(`${newName} vs ${oldName}: ${JSON.stringify(oldCalls.map(c => c.path))}`);
  for (let i = 0; i < newCalls.length; i++) {
    for (const [k, v] of Object.entries(newCalls[i].body)) {
      expect(oldCalls[i].body[k], `${newName} vs ${oldName}: body.${k} → ${newCalls[i].path}`).toEqual(v);
    }
    if (newCalls[i].headers) expect(oldCalls[i].headers, `${newName} vs ${oldName}: headers`).toEqual(newCalls[i].headers);
  }
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);
const isErr = (r: unknown) => (r as { isError?: boolean }).isError === true;

describe('entity_upsert: диспетчер по type ходит теми же путями, что перекрытые инструменты', () => {
  const P = 'NooriUta/UnlimitedLORE';
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['adr_new', { adr_id: 'ADR-1', name: 'n', status: 'ACCEPTED', project: P }, { type: 'adr', id: 'ADR-1', fields: { name: 'n', status: 'ACCEPTED', project: P } }],
    ['spec_new', { spec_id: 'S1', title: 't', version: '1.0', project: P }, { type: 'spec', id: 'S1', fields: { title: 't', version: '1.0', project: P } }],
    ['task_new', { sprint_id: 'SP', task_id: 'T1', title: 't', effort_days: 0.5 }, { type: 'task', id: 'SP/T1', fields: { title: 't', effort_days: 0.5 } }],
    ['sprint_new', { sprint_id: 'SP', name: 'n', project: P }, { type: 'sprint', id: 'SP', fields: { name: 'n', project: P } }],
    ['sprint_phase_new', { sprint_id: 'SP', phase_key: 'A', name: 'ph' }, { type: 'phase', fields: { sprint_id: 'SP', phase_key: 'A', name: 'ph' } }],
    ['release_new', { release_id: 'v1', type: 'minor', description_md: 'd' }, { type: 'release', id: 'v1', fields: { type: 'minor', description_md: 'd' } }],
    ['milestone_new', { milestone_id: 'M1', label: 'l', week: 2 }, { type: 'milestone', id: 'M1', fields: { label: 'l', week: 2 } }],
    ['milestone_set', { milestone_id: 'M1', goal_md: 'g' }, { type: 'milestone', id: 'M1', fields: { goal_md: 'g' } }],
    ['decision_new', { decision_id: 'D1', title: 't', project: P }, { type: 'decision', id: 'D1', fields: { title: 't', project: P } }],
    ['question_new', { question_id: 'Q1', title: 't', project: P }, { type: 'question', id: 'Q1', fields: { title: 't', project: P } }],
    ['component_new', { component_id: 'C1', full_name: 'f', area: 'platform' }, { type: 'component', id: 'C1', fields: { full_name: 'f', area: 'platform' } }],
    ['doc_new', { doc_id: 'd1', title: 't', project: P }, { type: 'doc', id: 'd1', fields: { title: 't', project: P } }],
    ['uc_new', { uc_id: 'UC-1', title: 't', goal_level: 'sea-level', project: P }, { type: 'uc', id: 'UC-1', fields: { title: 't', goal_level: 'sea-level', project: P } }],
    ['feature_new', { feature_id: 'F-1', title: 't', goal_level: 'kite', project: P }, { type: 'feature', id: 'F-1', fields: { title: 't', goal_level: 'kite', project: P } }],
    ['pain_new', { pain_id: 'P-1', title: 't', severity: 'high' }, { type: 'pain', id: 'P-1', fields: { title: 't', severity: 'high' } }],
    ['gain_new', { gain_id: 'G-1', title: 't', rank: 'essential', metric_md: 'm' }, { type: 'gain', id: 'G-1', fields: { title: 't', rank: 'essential', metric_md: 'm' } }],
    ['job_new', { job_id: 'J-1', title: 't', kind: 'functional' }, { type: 'job', id: 'J-1', fields: { title: 't', kind: 'functional' } }],
    ['runbook_new', { runbook_id: 'R-1', name: 'n', area: 'ops', project: P }, { type: 'runbook', id: 'R-1', fields: { name: 'n', area: 'ops', project: P } }],
    ['insight_new', { insight_id: 'I-1', statement_md: 's', insight_date: '2026-11-13' }, { type: 'insight', id: 'I-1', fields: { statement_md: 's', insight_date: '2026-11-13' } }],
    ['actor_new', { actor_id: 'A-1', name: 'n', kind: 'agent', project: P }, { type: 'actor', id: 'A-1', fields: { name: 'n', kind: 'agent', project: P } }],
    ['project_actor_new', { actor_id: 'PA-1', name: 'n', kind: 'human-role', project: P }, { type: 'project_actor', id: 'PA-1', fields: { name: 'n', kind: 'human-role', project: P } }],
    ['project_new', { slug: 'o/r', name: 'n', default_branch: 'develop' }, { type: 'project', id: 'o/r', fields: { name: 'n', default_branch: 'develop' } }],
    ['dict_set', { dict_type: 'priority', code: 'P0', label_ru: 'высокий', human_approval: 'boss: chat 13.11' }, { type: 'dict', fields: { dict_type: 'priority', code: 'P0', label_ru: 'высокий', human_approval: 'boss: chat 13.11' } }],
    ['tech_set', { component_id: 'YGG', tech_name: 'ArcadeDB', version: '26.6.1', license: 'MIT', project: P }, { type: 'tech', fields: { component_id: 'YGG', tech_name: 'ArcadeDB', version: '26.6.1', license: 'MIT', project: P } }],
    ['bragi_pub_new', { publication_id: 'PUB-1', title: 't', status_general: 'draft' }, { type: 'bragi_publication', id: 'PUB-1', fields: { title: 't', status_general: 'draft' } }],
    ['bragi_variant_new', { variant_id: 'V-1', text_md: 'x', channel_id: 'CH-TG' }, { type: 'bragi_variant', id: 'V-1', fields: { text_md: 'x', channel_id: 'CH-TG' } }],
    ['bragi_keyword_set', { keyword_id: 'KW-1', phrase: 'p', freq_exact: 10 }, { type: 'bragi_keyword', id: 'KW-1', fields: { phrase: 'p', freq_exact: 10 } }],
    ['bragi_page_set', { page_id: 'PG-1', url: 'u', page_type: 'landing' }, { type: 'bragi_page', id: 'PG-1', fields: { url: 'u', page_type: 'landing' } }],
    ['bragi_campaign_new', { campaign_id: 'CMP-1', utm_source: 's', period: '2026-11' }, { type: 'bragi_campaign', id: 'CMP-1', fields: { utm_source: 's', period: '2026-11' } }],
    ['bragi_rubric_set', { rubric_id: 'RUB-1', name: 'n', order_index: 1 }, { type: 'bragi_rubric', id: 'RUB-1', fields: { name: 'n', order_index: 1 } }],
    ['bragi_channel_set', { channel_id: 'CH-1', url_handle: 'h', rules_md: '- caption: 1024' }, { type: 'bragi_channel', id: 'CH-1', fields: { url_handle: 'h', rules_md: '- caption: 1024' } }],
    ['bragi_integration_new', { integration_id: 'INT-1', service: 's', secret_ref: 'env:X' }, { type: 'bragi_integration', id: 'INT-1', fields: { service: 's', secret_ref: 'env:X' } }],
  ];
  for (const [oldName, oldArgs, newArgs] of cases) {
    it(`${oldName} → entity_upsert type=${String(newArgs.type)}`, async () => {
      await parity(oldName, oldArgs, 'entity_upsert', newArgs);
    });
  }

  // Осознанное ужесточение относительно старых _set: project-guard применяется и к
  // амендам (у adr_set/question_set его не было) — анти-сироты 05.11 теперь покрывают
  // и правку, а не только создание. Отсюда два следствия, зафиксированные здесь:
  it('amend без project отбит guard\'ом (в отличие от старого adr_set)', async () => {
    calls.length = 0;
    const res = await byName['entity_upsert'].handler({ type: 'adr', id: 'ADR-1', fields: { name: 'n', decision_md: 'd' } });
    expect(isErr(res)).toBe(true);
    expect(text(res)).toContain('project required');
    expect(calls.length).toBe(0);
  });

  it('amend с project пишет и сразу вешает project-ребро (в отличие от старого adr_set)', async () => {
    calls.length = 0;
    const res = await byName['entity_upsert'].handler({ type: 'adr', id: 'ADR-1', fields: { name: 'n', decision_md: 'd', project: P } });
    expect(isErr(res)).toBe(false);
    expect(calls.map(c => c.path)).toEqual(['/lore/adr', '/lore/adr/project']);
    expect(calls[0].body).toEqual({ adr_id: 'ADR-1', name: 'n', decision_md: 'd' });
    expect(calls[1].body).toEqual({ adr_id: 'ADR-1', project: P, action: 'add' });
  });
});

describe('entity_link: диспетчер (type, rel) ходит теми же путями, что *_link-collapse', () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['adr_link', { adr_id: 'A', rel: 'component', target_id: 'C' }, { type: 'adr', id: 'A', rel: 'component', target_id: 'C' }],
    ['adr_link', { adr_id: 'A', rel: 'release', target_id: 'v1', git_project: 'o/r' }, { type: 'adr', id: 'A', rel: 'release', target_id: 'v1', fields: { git_project: 'o/r' } }],
    ['adr_link', { adr_id: 'A', rel: 'depends_on', target_id: 'A2', action: 'remove' }, { type: 'adr', id: 'A', rel: 'depends_on', target_id: 'A2', action: 'remove' }],
    ['sprint_link', { sprint_id: 'S', rel: 'project', target_id: 'o/r' }, { type: 'sprint', id: 'S', rel: 'project', target_id: 'o/r' }],
    ['sprint_link', { sprint_id: 'S', rel: 'dep', target_id: 'S2', kind: 'hard', reason: 'r' }, { type: 'sprint', id: 'S', rel: 'dep', target_id: 'S2', fields: { kind: 'hard', reason: 'r' } }],
    ['sprint_link', { sprint_id: 'S', rel: 'milestone', target_id: 'M1' }, { type: 'sprint', id: 'S', rel: 'milestone', target_id: 'M1' }],
    ['task_link', { task_uid: 'SP/T1', rel: 'phase', target_id: 'SP/PHASE_A' }, { type: 'task', id: 'SP/T1', rel: 'phase', target_id: 'SP/PHASE_A' }],
    ['task_link', { task_uid: 'SP/T1', rel: 'file', target_id: 'a/b.ts', project: 'o/r', summary_md: 's' }, { type: 'task', id: 'SP/T1', rel: 'file', target_id: 'a/b.ts', fields: { project: 'o/r', summary_md: 's' } }],
    ['task_link', { task_uid: 'SP/T1', rel: 'pr', target_id: 'o/r#1' }, { type: 'task', id: 'SP/T1', rel: 'pr', target_id: 'o/r#1' }],
    ['task_link', { task_uid: 'SP/T1', rel: 'adr', target_id: 'A' }, { type: 'task', id: 'SP/T1', rel: 'adr', target_id: 'A' }],
    ['task_link', { task_uid: 'SP/T1', rel: 'component', target_id: 'C' }, { type: 'task', id: 'SP/T1', rel: 'component', target_id: 'C' }],
    ['doc_link', { doc_id: 'd', rel: 'parent', target_id: 'p' }, { type: 'doc', id: 'd', rel: 'parent', target_id: 'p' }],
    ['doc_link', { doc_id: 'd', rel: 'sprint', target_id: 'S' }, { type: 'doc', id: 'd', rel: 'sprint', target_id: 'S' }],
    ['doc_link', { doc_id: 'd', rel: 'project', target_id: 'o/r' }, { type: 'doc', id: 'd', rel: 'project', target_id: 'o/r' }],
    ['runbook_link', { runbook_id: 'R', rel: 'adr', adr_id: 'A' }, { type: 'runbook', id: 'R', rel: 'adr', target_id: 'A' }],
    ['runbook_link', { runbook_id: 'R', rel: 'project', project: 'o/r' }, { type: 'runbook', id: 'R', rel: 'project', target_id: 'o/r' }],
    ['insight_link', { insight_id: 'I', rel: 'task', target_id: 'SP/T1' }, { type: 'insight', id: 'I', rel: 'task', target_id: 'SP/T1' }],
    ['release_link', { release_id: 'v1', rel: 'sprint', ids: ['S1', 'S2'], git_project: 'o/r' }, { type: 'release', id: 'v1', rel: 'sprint', target_id: ['S1', 'S2'], fields: { git_project: 'o/r' } }],
    ['release_link', { release_id: 'v1', rel: 'pr', ids: [1, 2], git_project: 'o/r' }, { type: 'release', id: 'v1', rel: 'pr', target_id: [1, 2], fields: { git_project: 'o/r' } }],
    ['release_unlink', { release_id: 'v1', git_project: 'o/r', sprint_ids: ['S1'] }, { type: 'release', id: 'v1', rel: 'sprint', target_id: 'S1', action: 'remove', fields: { git_project: 'o/r' } }],
    ['vp_link', { source_id: 'P-1', rel: 'blocks', target_id: 'J-1' }, { type: 'vp', id: 'P-1', rel: 'blocks', target_id: 'J-1' }],
    ['vp_link', { source_id: 'G-1', rel: 'success_of', target_id: 'J-1' }, { type: 'vp', id: 'G-1', rel: 'success_of', target_id: 'J-1' }],
    ['feature_link', { feature_id: 'F', rel: 'pain', target_id: 'P' }, { type: 'feature', id: 'F', rel: 'pain', target_id: 'P' }],
    ['feature_link', { feature_id: 'F', rel: 'builds_on', target_id: 'F2' }, { type: 'feature', id: 'F', rel: 'builds_on', target_id: 'F2' }],
    ['uc_link', { uc_id: 'U', rel: 'includes', target_id: 'U2' }, { type: 'uc', id: 'U', rel: 'includes', target_id: 'U2' }],
    ['uc_link', { uc_id: 'U', rel: 'actor', target_id: 'ACT', actor_role: 'primary' }, { type: 'uc', id: 'U', rel: 'actor', target_id: 'ACT', fields: { actor_role: 'primary' } }],
    ['uc_link', { uc_id: 'U', rel: 'performs', target_id: 'J-1' }, { type: 'uc', id: 'U', rel: 'performs', target_id: 'J-1' }],
    ['actor_link', { actor_id: 'AG', rel: 'fills_role', target_id: 'ACT' }, { type: 'actor', id: 'AG', rel: 'fills_role', target_id: 'ACT' }],
    ['decision_link', { decision_id: 'D', rel: 'component', target_id: 'C' }, { type: 'decision', id: 'D', rel: 'component', target_id: 'C' }],
    ['decision_link', { decision_id: 'D', rel: 'project', target_id: 'o/r' }, { type: 'decision', id: 'D', rel: 'project', target_id: 'o/r' }],
    ['question_link', { question_id: 'Q', rel: 'gates', target_id: 'SP/T1' }, { type: 'question', id: 'Q', rel: 'gates', target_id: 'SP/T1' }],
    ['question_link', { question_id: 'Q', rel: 'answers', target_id: 'D' }, { type: 'question', id: 'Q', rel: 'answers', target_id: 'D' }],
    ['question_link', { question_id: 'Q', rel: 'raised_in', target_id: 'A', target_type: 'adr' }, { type: 'question', id: 'Q', rel: 'raised_in', target_id: 'A', fields: { target_type: 'adr' } }],
    ['product_link', { product_code: 'AIDA', rel: 'component', target_id: 'C', role: 'owner' }, { type: 'product', id: 'AIDA', rel: 'component', target_id: 'C', fields: { role: 'owner' } }],
    ['product_link', { product_code: 'SVC', rel: 'serves', target_id: 'AIDA', kind: 'count' }, { type: 'product', id: 'SVC', rel: 'serves', target_id: 'AIDA', fields: { kind: 'count' } }],
    ['milestone_link', { milestone_id: 'M', rel: 'product', target_id: 'AIDA' }, { type: 'milestone', id: 'M', rel: 'product', target_id: 'AIDA' }],
    ['spec_link', { spec_id: 'S', target_id: 'C', rel: 'component' }, { type: 'spec', id: 'S', rel: 'component', target_id: 'C' }],
    ['spec_link', { spec_id: 'S', target_id: 'o/r', rel: 'project', mode: 'add' }, { type: 'spec', id: 'S', rel: 'project', target_id: 'o/r', fields: { mode: 'add' } }],
  ];
  for (const [oldName, oldArgs, newArgs] of cases) {
    it(`${oldName}(${String(oldArgs.rel)}) → entity_link type=${String(newArgs.type)}`, async () => {
      await parity(oldName, oldArgs, 'entity_link', newArgs);
    });
  }
});

describe('entity_delete / entity_move: паритет путей', () => {
  it('adr_del → entity_delete', async () => {
    await parity('adr_del', { adr_id: 'A' }, 'entity_delete', { type: 'adr', id: 'A' });
  });
  it('spec_del → entity_delete', async () => {
    await parity('spec_del', { spec_id: 'S' }, 'entity_delete', { type: 'spec', id: 'S' });
  });
  it('doc_del → entity_delete', async () => {
    await parity('doc_del', { doc_id: 'd' }, 'entity_delete', { type: 'doc', id: 'd' });
  });
  it('component_del → entity_delete', async () => {
    await parity('component_del', { component_id: 'C' }, 'entity_delete', { type: 'component', id: 'C' });
  });
  it('task_mv → entity_move', async () => {
    await parity('task_mv', { task_uid: 'SP/T1', target_sprint_id: 'SP2' }, 'entity_move', { type: 'task', id: 'SP/T1', target: 'SP2' });
  });
  it('release_mv (release) → entity_move', async () => {
    await parity('release_mv', { entity_type: 'release', id: 'v1', git_project: 'o/r' }, 'entity_move', { type: 'release', id: 'v1', target: 'o/r' });
  });
  it('release_mv (pr) → entity_move', async () => {
    await parity('release_mv', { entity_type: 'pr', id: 'o/r#1', git_project: 'o/r' }, 'entity_move', { type: 'pr', id: 'o/r#1', target: 'o/r' });
  });
});

describe('ошибки диспетчера: неизвестный type/rel → 400 с перечнем допустимых', () => {
  it('неизвестный type отбивается схемой с перечнем типов', () => {
    const schema = z.object(byName['entity_upsert'].schema).strict();
    const r = schema.safeParse({ type: 'nope', id: 'x', fields: {} });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toContain('actor');
  });

  it('неизвестный rel для типа → isError со списком rels типа', async () => {
    const res = await byName['entity_link'].handler({ type: 'adr', id: 'A', rel: 'felt_by', target_id: 'x' });
    expect(isErr(res)).toBe(true);
    expect(text(res)).toContain('valid rels: sprint, release, component, depends_on, supersedes, tag, project');
  });

  it('составной id у dict/phase/tech отбрасывается с подсказкой', async () => {
    const res = await byName['entity_upsert'].handler({ type: 'dict', id: 'P0', fields: { dict_type: 'priority', code: 'P0' } });
    expect(isErr(res)).toBe(true);
    expect(text(res)).toContain('composite id');
    expect(text(res)).toContain('dict_type + code');
  });

  it('task без uid "SPRINT/T" → isError с форматом', async () => {
    const res = await byName['entity_upsert'].handler({ type: 'task', id: 'nope', fields: { title: 't' } });
    expect(isErr(res)).toBe(true);
    expect(text(res)).toContain('SPRINT_X/T05');
  });

  it('project-guard: adr без project и без LORE_ACTIVE_PROJECT → отказ до записи', async () => {
    calls.length = 0;
    const res = await byName['entity_upsert'].handler({ type: 'adr', id: 'A', fields: { name: 'n' } });
    expect(isErr(res)).toBe(true);
    expect(text(res)).toContain('project required');
    expect(calls.length, 'отказ должен быть ДО сети').toBe(0);
  });

  it('decision с adr_id проходит guard без project', async () => {
    calls.length = 0;
    const res = await byName['entity_upsert'].handler({ type: 'decision', id: 'D', fields: { title: 't', adr_id: 'A' } });
    expect(isErr(res)).toBe(false);
    expect(calls.map(c => c.path)).toEqual(['/lore/decision']);
  });

  it('question status="closed" → guidance, не запись', async () => {
    calls.length = 0;
    const res = await byName['entity_upsert'].handler({ type: 'question', id: 'Q', fields: { title: 't', status: 'closed', project: 'p' } });
    expect(isErr(res)).toBe(true);
    expect(text(res)).toContain('question_link rel="answers"');
    expect(calls.length).toBe(0);
  });

  it('dict: human_approval уходит заголовком, не телом', async () => {
    calls.length = 0;
    const res = await byName['entity_upsert'].handler({ type: 'dict', fields: { dict_type: 'priority', code: 'P0', human_approval: 'boss: chat' } });
    expect(isErr(res)).toBe(false);
    expect(calls[0].path).toBe('/lore/dict/entry');
    expect(calls[0].body).not.toHaveProperty('human_approval');
    expect(calls[0].headers?.['X-Lore-Human-Approval']).toBe(encodeURIComponent('boss: chat'));
  });

  it('spec: action не принимается — режим задаёт fields.mode', async () => {
    const res = await byName['entity_link'].handler({ type: 'spec', id: 'S', rel: 'component', target_id: 'C', action: 'add' });
    expect(isErr(res)).toBe(true);
    expect(text(res)).toContain('fields.mode');
  });

  it('insight: action="remove" отбит (endpoint add-only)', async () => {
    const res = await byName['entity_link'].handler({ type: 'insight', id: 'I', rel: 'task', target_id: 'SP/T1', action: 'remove' });
    expect(isErr(res)).toBe(true);
    expect(text(res)).toContain('add-only');
  });

  it('release: без fields.git_project → isError с причиной', async () => {
    const res = await byName['entity_link'].handler({ type: 'release', id: 'v1', rel: 'pr', target_id: [1] });
    expect(isErr(res)).toBe(true);
    expect(text(res)).toContain('git_project');
  });

  it('task rel=file без fields.project → isError', async () => {
    const res = await byName['entity_link'].handler({ type: 'task', id: 'SP/T1', rel: 'file', target_id: 'a/b.ts' });
    expect(isErr(res)).toBe(true);
    expect(text(res)).toContain('fields.project');
  });
});

describe('совместимость: legacy-флаг и профили меняют регистрацию', () => {
  const registeredNames = (gate: (tool: string) => boolean): string[] => {
    const names: string[] = [];
    const fake = {
      tool: (...args: unknown[]) => { names.push(args[0] as string); },
      registerTool: ((name: string) => { names.push(name); }) as never,
    } as unknown as McpServer;
    registerLoreWrite(withStrictTools(fake, gate));
    return names;
  };

  it('LEGACY_CRUD_TOOLS: каждое имя — реальный инструмент, без дублей, entity_* не входят', () => {
    const all = tools.map(t => t.name);
    for (const n of LEGACY_CRUD_TOOLS) expect(all, `имя ${n} не регистрируется`).toContain(n);
    expect(new Set(LEGACY_CRUD_TOOLS).size).toBe(LEGACY_CRUD_TOOLS.length);
    for (const n of ['entity_upsert', 'entity_link', 'entity_delete', 'entity_move']) {
      expect(all).toContain(n);
      expect(LEGACY_CRUD_TOOLS).not.toContain(n);
    }
    // Узкие не-generic инструменты консолидацией НЕ затронуты — остаются всегда.
    for (const n of ['status_set', 'status_set_batch', 'sprint_set', 'sprint_plan_set', 'task_set',
      'release_set', 'component_set', 'decision_set', 'milestone_sprints', 'adr_rename',
      'qg_new', 'qg_job_new', 'qg_run_log', 'rec_new', 'rec_promote', 'agent_session_log',
      'machine_new', 'machine_owner_set', 'machine_access_set', 'project_role_set',
      'metric_log', 'metric_get', 'asset_up', 'bragi_asset_up', 'bragi_asset_attach', 'bragi_sync']) {
      expect(LEGACY_CRUD_TOOLS, `${n} ошибочно скрыт`).not.toContain(n);
    }
  });

  it('дефолт (full, без осей): старые покрытые имена скрыты, entity_* видны', () => {
    const names = registeredNames(legacySurfaceGate(gateFor([fullPermission()]), { legacy: false, narrowed: false }));
    for (const n of ['entity_upsert', 'entity_link', 'entity_delete', 'entity_move']) expect(names).toContain(n);
    for (const n of LEGACY_CRUD_TOOLS) expect(names, `${n} должен быть скрыт по умолчанию`).not.toContain(n);
    // Не покрытые узкие — на месте.
    for (const n of ['status_set', 'task_set', 'sprint_set', 'qg_new', 'metric_log']) expect(names).toContain(n);
  });

  it('LORE_MCP_LEGACY=1: полная старая поверхность + entity_*', () => {
    const names = registeredNames(legacySurfaceGate(gateFor([fullPermission()]), { legacy: true, narrowed: false }));
    for (const n of LEGACY_CRUD_TOOLS) expect(names).toContain(n);
    for (const n of ['entity_upsert', 'entity_link', 'entity_delete', 'entity_move']) expect(names).toContain(n);
  });

  it('профиль ≠ full: старые имена в рамках профиля, entity_* профилем не разрешён — скрыт', () => {
    const names = registeredNames(legacySurfaceGate(gateFor([permissionForProfile('developer')]), { legacy: false, narrowed: true }));
    expect(names).toContain('task_new');       // developer по-прежнему видит task_*
    expect(names).toContain('task_set');
    expect(names).toContain('adr_new');        // и adr_new (Design-in-Build)
    expect(names).not.toContain('sprint_new'); // sprint_* профилю не положен
    expect(names).not.toContain('entity_upsert'); // профиль не знает entity_* — profile gate скрыл
    expect(names).not.toContain('entity_link');
  });

  it('read-only core: entity_* скрыты вместе со всеми пишущими', () => {
    const names = registeredNames(legacySurfaceGate(gateFor([corePermission()]), { legacy: false, narrowed: true }));
    for (const n of ['entity_upsert', 'entity_link', 'entity_delete', 'entity_move', 'task_new', 'adr_new']) {
      expect(names).not.toContain(n);
    }
    expect(names).toContain('quality_check');
  });
});
