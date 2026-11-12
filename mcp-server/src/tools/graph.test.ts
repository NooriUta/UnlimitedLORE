import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect, type Tool } from './writeToolHarness.js';

// SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04 (11.11.2026): инструмент `graph` — обёртка над
// GET /lore/graph. Повод — владелица: «в графе нужны супер-сервисы от серверной части:
// связи определённого типа, связи 2, 3, 4 уровней глубины». Агент получает тот же граф,
// что GraphExplorer: окрестность записи (type+id, depth 1..4, rels) или срез (scope).
//
// Тонкая обёртка: параметры уходят как есть, без выдуманных значений по умолчанию;
// ответ — целиком, вместе с meta (truncated/capped_at/dangling/rels_available/by_depth):
// «обрезано потолком» не должно по дороге превращаться в «это вся окрестность».

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
  const t = collect(registerLoreRead).find((x) => x.name === 'graph');
  if (!t) throw new Error('graph не зарегистрирован');
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

describe('MCP graph — граф одним запросом', () => {
  it('окрестность: type, id, depth 4, rels, types, structural, limit — строками на GET /lore/graph', async () => {
    answer = { nodes: [], edges: [], meta: { complete: true } };
    await run({ type: 'adr', id: 'ADR-LORE-038', depth: 4, rels: 'DEPENDS_ON,JUSTIFIED_BY',
      types: 'adr,task', structural: true, limit: 300 });
    expect(calls).toEqual([{
      path: '/lore/graph',
      params: { type: 'adr', id: 'ADR-LORE-038', depth: '4', rels: 'DEPENDS_ON,JUSTIFIED_BY',
        types: 'adr,task', structural: 'true', limit: '300' },
    }]);
  });

  it('срез: только scope, без подстановки проекта из LORE_ACTIVE_PROJECT', async () => {
    await run({ scope: 'all' });
    expect(calls[0].params).toEqual({ scope: 'all' });
  });

  it('ответ целиком — truncated, rels_available и by_depth не теряются', async () => {
    answer = { nodes: [{ id: 'A', depth: 0 }], edges: [],
      meta: { complete: false, truncated: true, capped_at: 500,
        rels_available: [{ rel: 'DEPENDS_ON', count: 3 }], by_depth: { '1': 0, '2': 0 } } };
    const { text, isError } = await run({ type: 'sprint', id: 'S1', depth: 2 });
    expect(isError).toBe(false);
    const body = JSON.parse(text);
    expect(body.meta.truncated).toBe(true);
    expect(body.meta.capped_at).toBe(500);
    expect(body.meta.rels_available).toEqual([{ rel: 'DEPENDS_ON', count: 3 }]);
    expect(body.meta.by_depth).toEqual({ '1': 0, '2': 0 });
  });

  it('отказ бэкенда — ошибка инструмента, а не пустой граф', async () => {
    fail = new Error('GET /lore/graph → 403 {"error":"OUTSIDE_SCOPE"}');
    const { text, isError } = await run({ type: 'adr', id: 'X' });
    expect(isError).toBe(true);
    expect(text).toContain('OUTSIDE_SCOPE');
  });
});
