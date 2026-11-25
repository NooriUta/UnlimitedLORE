import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_FORGEJO_MINIAPP/FJ-03 (ADR-LORE-060 R3): один инструмент forgejo {route, args, truncate?} →
// POST /lore/forgejo-app/{route} и forgejo_describe {route? | group?} → GET /lore/forgejo-app/describe.
// Тонкий слой: ответ — конверт v=1 как есть + строка-сводка для читателя; failed ≠ empty, isError — только транспорт.

type Call = { path: string; body?: unknown; query?: string };
const calls: Call[] = [];
let envelopeAnswer: unknown;
let envelopeThrows: Error | undefined;

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async () => ({ ok: true })),
  loreGet: vi.fn(async (path: string, params?: Record<string, string>) => {
    calls.push({ path, query: new URLSearchParams(params ?? {}).toString() });
    return { v: 1, kind: 'forgejo:*', outcome: 'found', data: { groups: {} }, meta: {}, error: null };
  }),
  loreEnvelope: vi.fn(async (path: string, body: unknown) => {
    calls.push({ path, body });
    if (envelopeThrows) throw envelopeThrows;
    return envelopeAnswer;
  }),
}));

const { registerForgejo } = await import('./forgejo.js');
const { toolKind } = await import('./toolKinds.js');

const ENV = { LORE_FORGEJO: '1' } as NodeJS.ProcessEnv;
const tools = collect((s) => registerForgejo(s, ENV));
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

type Res = { isError?: boolean; content: { type: string; text: string }[] };

beforeEach(() => {
  calls.length = 0;
  envelopeThrows = undefined;
  envelopeAnswer = { v: 1, kind: 'forgejo:list_issues', outcome: 'found', data: [{ number: 1 }],
    meta: { took_ms: 3, cursor: 'eyJvIjoyMH0', has_more: true, truncated: null }, error: null };
});

describe('forgejo — один инструмент на 107+ маршрутов', () => {
  it('регистрируется при заявленном мосте вместе с forgejo_describe, без моста — нет', () => {
    expect(Object.keys(byName)).toEqual(expect.arrayContaining(['forgejo', 'forgejo_describe']));
    expect(collect((s) => registerForgejo(s, {} as NodeJS.ProcessEnv)).map((t) => t.name)).toEqual([]);
  });

  it('схема фиксированная: route, args, truncate', () => {
    expect(Object.keys(byName.forgejo.schema).sort()).toEqual(['args', 'route', 'truncate']);
    expect(Object.keys(byName.forgejo_describe.schema).sort()).toEqual(['group', 'route']);
  });

  it('шлёт POST /lore/forgejo-app/{route} с args телом; конверт — как есть, плюс сводка', async () => {
    const r = (await byName.forgejo.handler({ route: 'list_issues', args: { owner: 'AIDA', repo: 'X', limit: 20 } })) as Res;
    expect(calls).toEqual([{ path: '/lore/forgejo-app/list_issues', body: { owner: 'AIDA', repo: 'X', limit: 20 } }]);
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('forgejo:list_issues');
    expect(r.content[0].text).toContain('has_more');
    expect(JSON.parse(r.content[1].text)).toEqual(envelopeAnswer);
  });

  it('truncate:false уходит параметром запроса', async () => {
    await byName.forgejo.handler({ route: 'get_pr_diff', args: { owner: 'A', repo: 'B', index: 1 }, truncate: false });
    expect(calls[0].path).toBe('/lore/forgejo-app/get_pr_diff?truncate=false');
  });

  it('outcome=failed не превращается в пустой список и не isError (отказ — данные)', async () => {
    envelopeAnswer = { v: 1, kind: 'forgejo:create_issue', outcome: 'failed', data: null, meta: { took_ms: 0 },
      error: { code: 'FORBIDDEN_FOR_ROLE', status: 403, allowed: ['full', 'developer'], hint: 'кого спросить' } };
    const r = (await byName.forgejo.handler({ route: 'create_issue', args: {} })) as Res;
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('failed');
    expect(r.content[0].text).toContain('FORBIDDEN_FOR_ROLE');
    expect(r.content[0].text).not.toMatch(/empty|пусто/i);
    expect(JSON.parse(r.content[1].text).error.code).toBe('FORBIDDEN_FOR_ROLE');
  });

  it('транспорт (бэкенд недоступен, не конверт) — isError', async () => {
    envelopeThrows = new Error('POST /lore/forgejo-app/list_issues → 502 upstream');
    const r = (await byName.forgejo.handler({ route: 'list_issues', args: {} })) as Res;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('502');
  });

  it('имя маршрута кодируется в пути', async () => {
    await byName.forgejo.handler({ route: '../admin', args: {} });
    expect(calls[0].path).toBe('/lore/forgejo-app/..%2Fadmin');
  });

  it('forgejo_describe → GET /lore/forgejo-app/describe с route|group', async () => {
    await byName.forgejo_describe.handler({ route: 'list_issues' });
    await byName.forgejo_describe.handler({ group: 'read' });
    await byName.forgejo_describe.handler({});
    expect(calls.map((c) => `${c.path}?${c.query}`)).toEqual([
      '/lore/forgejo-app/describe?route=list_issues',
      '/lore/forgejo-app/describe?group=read',
      '/lore/forgejo-app/describe?',
    ]);
  });

  it('сторож read|cud: forgejo — cud (исполняет и запись), forgejo_describe — read', () => {
    expect(toolKind('forgejo')).toBe('cud');
    expect(toolKind('forgejo_describe')).toBe('read');
  });
});
