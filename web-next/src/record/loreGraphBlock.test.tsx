// SPRINT_UXR_S12_KIT3_VOLVA_GRAPH/S6-04 — блок lore-graph в тексте записи рисуется общим графом kit
// (GraphExplorer), а не остаётся кодом. Параметры — строками «ключ: значение» в теле блока.
import { describe, expect, it } from 'vitest';
import { LiveBlockError } from '@seidr/kit/content';
import { loreGraphRun, parseLoreGraph } from './loreGraphBlock';

const THIS = { 'this.id': 'SPRINT_A', 'this.type': 'sprint' };

describe('lore-graph: разбор', () => {
  it('пустой блок — эта запись, глубина 1', () => {
    expect(parseLoreGraph('', THIS)).toEqual({ ok: true, type: 'sprint', id: 'SPRINT_A', depth: 1, rels: [], structural: false });
  });

  it('of / depth / rels / structural', () => {
    expect(parseLoreGraph('of: task:SPRINT_B/T-1\ndepth: 3\nrels: IMPLEMENTED_IN, BELONGS_TO\nstructural: true', THIS))
      .toEqual({ ok: true, type: 'task', id: 'SPRINT_B/T-1', depth: 3, rels: ['IMPLEMENTED_IN', 'BELONGS_TO'], structural: true });
  });

  it('of: $this — эта запись; комментарии и пустые строки пропускаются', () => {
    expect(parseLoreGraph('# соседи\n\nof: $this\ndepth: 2', THIS)).toMatchObject({ ok: true, type: 'sprint', id: 'SPRINT_A', depth: 2 });
  });

  it('ошибки — кодом, а не пустым графом', () => {
    expect(parseLoreGraph('depth: 5', THIS)).toMatchObject({ ok: false, code: 'BAD_DEPTH' });
    expect(parseLoreGraph('depth: два', THIS)).toMatchObject({ ok: false, code: 'BAD_DEPTH' });
    expect(parseLoreGraph('color: red', THIS)).toMatchObject({ ok: false, code: 'UNKNOWN_KEY' });
    expect(parseLoreGraph('of: SPRINT_A', THIS)).toMatchObject({ ok: false, code: 'BAD_OF' });
    expect(parseLoreGraph('', {})).toMatchObject({ ok: false, code: 'UNRESOLVED_VAR' });
    expect(parseLoreGraph('rels: bad rel', THIS)).toMatchObject({ ok: false, code: 'BAD_RELS' });
  });
});

const graphBody = {
  nodes: [
    { id: 'SPRINT_A', type: 'sprint', title: 'Спринт А', status: null, status_category: null, depth: 0 },
    { id: 'SPRINT_A/T-1', type: 'task', title: 'Задача', status: 'done', status_category: 'done', depth: 1 },
  ],
  edges: [{ from: 'SPRINT_A/T-1', rel: 'IMPLEMENTED_IN', to: 'SPRINT_A' }],
  meta: { complete: true, truncated: false, depth: 1 },
};

function fakeFetch(status: number, body: unknown, date = 'Fri, 13 Nov 2026 20:00:00 GMT') {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', Date: date } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('lore-graph: исполнение', () => {
  it('идёт в /lore/graph с параметрами блока и отдаёт вид с числом узлов и временем сервера', async () => {
    const { f, calls } = fakeFetch(200, graphBody);
    const r = await loreGraphRun(THIS, f)('depth: 2\nrels: IMPLEMENTED_IN', new AbortController().signal);
    expect(calls).toEqual(['/lore/graph?type=sprint&id=SPRINT_A&depth=2&rels=IMPLEMENTED_IN']);
    expect(r).toMatchObject({ kind: 'view', shown: 1, empty: false, generatedAt: '2026-11-13T20:00:00.000Z' });
  });

  it('только сама запись — проверенный ноль соседей, а не ошибка', async () => {
    const { f } = fakeFetch(200, { ...graphBody, nodes: [graphBody.nodes[0]], edges: [] });
    const r = await loreGraphRun(THIS, f)('', new AbortController().signal);
    expect(r).toMatchObject({ kind: 'view', shown: 0, empty: true });
  });

  it('403 — отказ с кодом и статусом (блок покажет «нет прав», а не пусто)', async () => {
    const { f } = fakeFetch(403, { error: 'FORBIDDEN' });
    await expect(loreGraphRun(THIS, f)('', new AbortController().signal)).rejects.toMatchObject({ status: 403 });
    await expect(loreGraphRun(THIS, f)('', new AbortController().signal)).rejects.toBeInstanceOf(LiveBlockError);
  });

  it('ошибка разбора — отказ до запроса', async () => {
    const { f, calls } = fakeFetch(200, graphBody);
    await expect(loreGraphRun(THIS, f)('depth: 9', new AbortController().signal)).rejects.toMatchObject({ code: 'BAD_DEPTH' });
    expect(calls).toEqual([]);
  });
});
