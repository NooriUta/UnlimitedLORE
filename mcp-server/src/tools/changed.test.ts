import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect, type Tool } from './writeToolHarness.js';

// SPRINT_LORE_MEASURE_TRUTH/MT-MCP-CHANGED-RANGE, остаток (v1.17.14): инструмент `changed` —
// «что изменилось с … по …» по многим типам одним вызовом (GET /lore/changed). Повод —
// владелица 11.11.2026: после ревью «закрыли 27, 42 на доработку» агенту нечем было
// посмотреть правки за период по всем объектам сразу.
//
// Инструмент — тонкая обёртка: параметры уходят на бэкенд как есть (без выдуманных
// значений по умолчанию), ответ — целиком, вместе с errors[]/complete: «тип не прочитался»
// не должен исчезать по дороге и превращаться в «ничего не изменилось».

const calls: { path: string; params?: Record<string, string> }[] = [];
let answer: unknown = {};
let fail: Error | undefined;

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: 'NooriUta/UnlimitedLORE',
  loreGet: vi.fn(async (path: string, params?: Record<string, string>) => {
    calls.push({ path, params });
    if (fail) throw fail;
    return answer;
  }),
  loreSlices: vi.fn(async () => ({ slices: [] })),
  loreSliceWithMeta: vi.fn(async () => ({ rows: [] })),
}));

const { registerLoreRead } = await import('./loreRead.js');

function tool(): Tool {
  const t = collect(registerLoreRead).find((x) => x.name === 'changed');
  if (!t) throw new Error('changed не зарегистрирован');
  return t;
}

async function run(args: Record<string, unknown>) {
  const res = (await tool().handler(args)) as { content: { text: string }[]; isError?: boolean };
  return { text: res.content[0].text, isError: res.isError === true };
}

beforeEach(() => {
  calls.length = 0;
  answer = {};
  fail = undefined;
});

describe('MCP changed — что изменилось за период', () => {
  it('зовёт GET /lore/changed и передаёт только заданные параметры строками', async () => {
    answer = { rows: [], page: { total: 0 }, errors: [], complete: true, nothing_changed: true };
    await run({ from: '2026-11-10', to: '2026-11-11', types: 'task,adr', status_category: 'closed', limit: 5 });
    expect(calls).toEqual([{
      path: '/lore/changed',
      params: { from: '2026-11-10', to: '2026-11-11', types: 'task,adr', status_category: 'closed', limit: '5' },
    }]);
  });

  it('проект не подставляется молча из LORE_ACTIVE_PROJECT — только явный', async () => {
    await run({ from: '2026-11-10' });
    expect(calls[0].params).toEqual({ from: '2026-11-10' });
    await run({ from: '2026-11-10', project: 'NooriUta/UnlimitedLORE', actor: 'kimi', offset: 20 });
    expect(calls[1].params).toEqual({ from: '2026-11-10', project: 'NooriUta/UnlimitedLORE', actor: 'kimi', offset: '20' });
  });

  it('ответ отдаётся целиком — errors[] и complete:false не теряются', async () => {
    answer = { rows: [], page: { total: 0 }, errors: [{ type: 'adr', stage: 'list', reason: 'upstream 502' }],
      complete: false, nothing_changed: false, warning: 'not read: adr' };
    const { text, isError } = await run({ from: '2026-11-10' });
    expect(isError).toBe(false);
    const body = JSON.parse(text);
    expect(body.complete).toBe(false);
    expect(body.errors).toEqual([{ type: 'adr', stage: 'list', reason: 'upstream 502' }]);
    expect(body.nothing_changed).toBe(false);
  });

  it('отказ бэкенда — ошибка инструмента, а не пустой список', async () => {
    fail = new Error('GET /lore/changed → 400 {"error":"BAD_PARAMS","detail":"unknown type: bogus"}');
    const { text, isError } = await run({ from: '2026-11-10', types: 'bogus' });
    expect(isError).toBe(true);
    expect(text).toContain('BAD_PARAMS');
  });
});
