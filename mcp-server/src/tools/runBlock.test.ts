import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect, type Tool } from './writeToolHarness.js';

// SPRINT_UXR_S6_VOLVA_IN_LORE/S6-08 — «выполнить блок» для агентов.
//
// Агент передаёт исходник блока lore-query (как он лежит в Markdown записи,
// SPEC-LORE-UXR-EMBED-BLOCKS) и получает строки вместе с честными метаданными
// полноты: всего, обрезано ли, есть ли ещё, сужен ли скоупом, предупреждения.
// Главный инвариант: «не смогли выполнить» никогда не выглядит как «пусто» —
// у ошибки нет rows:[], у неё status:"error" и причина.

type SliceAnswer = { rows: unknown[]; meta?: unknown; page?: unknown; extra?: Record<string, unknown> };
let sliceAnswer: (slice: string, params?: Record<string, string>) => Promise<SliceAnswer>;
const calls: { slice: string; params?: Record<string, string> }[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  loreGet: vi.fn(async () => ({})),
  loreSlices: vi.fn(async () => ({ slices: [] })),
  loreSliceWithMeta: vi.fn(async (slice: string, params?: Record<string, string>) => {
    calls.push({ slice, params });
    return sliceAnswer(slice, params);
  }),
}));

const { parseLoreQueryBlock } = await import('./runBlock.js');
const { registerLoreRead } = await import('./loreRead.js');

function tool(): Tool {
  const t = collect(registerLoreRead).find((x) => x.name === 'run_block');
  if (!t) throw new Error('run_block не зарегистрирован');
  return t;
}

async function run(args: Record<string, unknown>) {
  const res = (await tool().handler(args)) as { content: { text: string }[]; isError?: boolean };
  return { body: JSON.parse(res.content[0].text), isError: res.isError === true };
}

describe('разбор блока lore-query', () => {
  it('ограждённый блок: срез, where … and …, limit/offset/fields', () => {
    const p = parseLoreQueryBlock(
      '```lore-query\nsprints | where project = "NooriUta/UnlimitedLORE" and status = active\n        | limit 5 | offset 10 | fields sprint_id,status\n```');
    expect(p).toEqual({
      ok: true,
      slice: 'sprints',
      params: { project: 'NooriUta/UnlimitedLORE', status: 'active', limit: '5', offset: '10', fields: 'sprint_id,status' },
      warnings: [],
    });
  });

  it('тело без ограды тоже принимается', () => {
    const p = parseLoreQueryBlock('adr | where id = ADR-LORE-017');
    expect(p).toMatchObject({ ok: true, slice: 'adr', params: { id: 'ADR-LORE-017' } });
  });

  it('$this.* подставляется из vars; без значения — ошибка, а не пустой параметр', () => {
    expect(parseLoreQueryBlock('sprints | where project = $this.project', { 'this.project': 'P/X' }))
      .toMatchObject({ ok: true, params: { project: 'P/X' } });
    expect(parseLoreQueryBlock('sprints | where project = $this.project'))
      .toMatchObject({ ok: false, code: 'UNRESOLVED_VAR' });
  });

  it('chart — только вид: выполняется с предупреждением', () => {
    const p = parseLoreQueryBlock('sprints | chart bar');
    expect(p).toMatchObject({ ok: true, slice: 'sprints', params: {} });
    expect((p as { warnings: string[] }).warnings.join(' ')).toMatch(/chart/);
  });

  it('то, что исказило бы ответ, отказывается явно', () => {
    expect(parseLoreQueryBlock('sprints | group by status')).toMatchObject({ ok: false, code: 'UNSUPPORTED_STAGE' });
    expect(parseLoreQueryBlock('sprints | where status in (active, blocked)')).toMatchObject({ ok: false, code: 'UNSUPPORTED_CONDITION' });
    expect(parseLoreQueryBlock('question: 42')).toMatchObject({ ok: false, code: 'UNSUPPORTED_FORM' });
    expect(parseLoreQueryBlock('```lore-graph depth=2\n```')).toMatchObject({ ok: false, code: 'NOT_LORE_QUERY' });
    expect(parseLoreQueryBlock('   ')).toMatchObject({ ok: false, code: 'EMPTY_BLOCK' });
  });
});

describe('run_block: строки + метаданные полноты', () => {
  beforeEach(() => { calls.length = 0; });

  it('регистрируется рядом с query_slice', () => {
    expect(collect(registerLoreRead).map((t) => t.name)).toContain('run_block');
  });

  it('полная выдача: total = числу строк, truncated:false, has_more:false', async () => {
    sliceAnswer = async () => ({ rows: [{ a: 1 }, { a: 2 }] });
    const { body, isError } = await run({ block: 'sprints | where status = active' });
    expect(isError).toBe(false);
    expect(calls).toEqual([{ slice: 'sprints', params: { status: 'active' } }]);
    expect(body.status).toBe('ok');
    expect(body.rows).toHaveLength(2);
    expect(body.meta).toMatchObject({ returned: 2, total: 2, truncated: false, has_more: false, complete: true });
    expect(body.meta.scope.narrowed).toBe(false);
  });

  it('усечённая бэкендом выдача: total неизвестен (null), а не равен числу строк', async () => {
    sliceAnswer = async () => ({ rows: [{ a: 1 }], meta: { truncated: true, limit: 1, hint: 'сузьте' } });
    const { body } = await run({ block: 'tasks' });
    expect(body.meta).toMatchObject({ returned: 1, total: null, truncated: true, has_more: true, complete: false });
    expect(body.meta.warnings.join(' ')).toMatch(/сузьте/);
  });

  it('страница: total и has_more из page', async () => {
    sliceAnswer = async () => ({ rows: [{ a: 1 }], page: { limit: 1, offset: 0, total: 7, has_more: true } });
    const { body } = await run({ block: 'tasks | limit 1' });
    expect(body.meta).toMatchObject({ returned: 1, total: 7, has_more: true, complete: false, limit: 1, offset: 0 });
  });

  it('проектный скоуп бэкенда виден как narrowed:true', async () => {
    sliceAnswer = async () => ({
      rows: [],
      extra: {
        scope: { applied: true, projects: 2, note: 'сужено' },
        scope_projects: { applied: true, projects: ['P/X'] },
        outside_scope: { id: 'ADR-1', verdict: 'outside_scope' },
      },
    });
    const { body } = await run({ block: 'adr | where id = ADR-1' });
    expect(body.status).toBe('ok');
    expect(body.meta.scope).toMatchObject({
      narrowed: true,
      backend_scope: { applied: true, projects: 2 },
      scope_projects: { applied: true },
      outside_scope: { verdict: 'outside_scope' },
    });
    expect(body.meta.warnings.join(' ')).toMatch(/outside_scope|вне/);
  });

  it('сбой бэкенда — status:error, isError, и НЕТ rows:[]', async () => {
    sliceAnswer = async () => { throw new Error('GET /lore/slice/tasks → 502 DB_UNAVAILABLE'); };
    const { body, isError } = await run({ block: 'tasks' });
    expect(isError).toBe(true);
    expect(body.status).toBe('error');
    expect(body.error).toMatchObject({ stage: 'execute' });
    expect(body.error.message).toMatch(/502/);
    expect(body).not.toHaveProperty('rows');
  });

  it('неразборный блок — status:error на стадии parse, бэкенд не зовётся', async () => {
    const { body, isError } = await run({ block: 'sprints | group by status' });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ status: 'error', error: { stage: 'parse', code: 'UNSUPPORTED_STAGE' } });
    expect(body).not.toHaveProperty('rows');
    expect(calls).toEqual([]);
  });
});
