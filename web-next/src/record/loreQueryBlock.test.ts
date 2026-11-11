// Исполнитель блока lore-query в тексте записи (SPRINT_UXR_S12_KIT3_VOLVA_GRAPH/S6-04).
// Язык — свой конвейер (ответ владелицы 11.11, вопрос 1в): тот же, что у
// MCP run_block (S6-08). Сторож паритета ниже: человек и агент обязаны
// разбирать блок одинаково — иначе агент «видит» в записи не то, что человек.
import { describe, expect, it } from 'vitest';
import { LiveBlockError } from '@seidr/kit/content';
import { parseLoreQuery, loreQueryRun } from './loreQueryBlock';

// Модуль MCP грузится по пути, собранному во время выполнения: tsc web-next не
// должен проверять чужой пакет (у mcp-server свой tsconfig и lib), а vitest его исполнит.
const MCP_RUN_BLOCK = ['..', '..', '..', 'mcp-server', 'src', 'tools', 'runBlock.ts'].join('/');
type McpParse = (text: string, vars?: Record<string, string>) => unknown;

const CASES: [string, Record<string, string>][] = [
  ['tasks_of_sprint | where sprint_id = $this.id', { 'this.id': 'S_A' }],
  ['tasks_of_sprint | where sprint_id = "S_A" and status = done | limit 5 | offset 10 | fields task_uid, title', {}],
  ['tasks_of_sprint | group by status', {}],
  ['tasks_of_sprint | where sprint_id in (a, b)', {}],
  ['tasks_of_sprint | where sprint_id = $this.parent', {}],
  ['question: 42', {}],
  ['', {}],
  ['bad slice! | limit 1', {}],
  ['tasks_of_sprint | limit x', {}],
  ['tasks_of_sprint ||', {}],
  ['tasks_of_sprint | chart bar', {}],
];

describe('разбор lore-query', () => {
  it('паритет с MCP run_block: на каждом примере тот же итог', async () => {
    const { parseLoreQueryBlock } = (await import(/* @vite-ignore */ new URL(MCP_RUN_BLOCK, import.meta.url).href)) as { parseLoreQueryBlock: McpParse };
    for (const [src, vars] of CASES) expect(parseLoreQuery(src, vars)).toEqual(parseLoreQueryBlock(src, vars));
  });
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('исполнение', () => {
  it('срез с параметрами из where; колонки — из fields; всего — из page.total; время — из ответа сервера', async () => {
    let url = '';
    const run = loreQueryRun({ 'this.id': 'S_A' }, async u => {
      url = String(u);
      return json(200, { rows: [{ task_uid: 'S_A/T-1', title: 'Один', extra: 'x' }], page: { limit: 1, offset: 0, total: 8, has_more: true } }, { date: 'Wed, 11 Nov 2026 14:02:00 GMT' });
    });
    const r = await run('tasks_of_sprint | where sprint_id = $this.id | limit 1 | fields task_uid,title', new AbortController().signal);
    expect(url).toContain('/lore/slice/tasks_of_sprint?');
    expect(url).toContain('sprint_id=S_A');
    expect(r.kind).toBe('table');
    if (r.kind !== 'table') return;
    expect(r.columns.map(c => c.key)).toEqual(['task_uid', 'title']);
    expect(r.total).toBe(8);
    expect(r.generatedAt).toBe('2026-11-11T14:02:00.000Z');
  });

  it('отказ разбора — LiveBlockError с кодом, сервер не зовём', async () => {
    let called = false;
    const run = loreQueryRun({}, async () => { called = true; return json(200, { rows: [] }); });
    const e = await run('tasks_of_sprint | group by status', new AbortController().signal).catch(x => x);
    expect(e).toBeInstanceOf(LiveBlockError);
    expect((e as LiveBlockError).code).toBe('UNSUPPORTED_STAGE');
    expect(called).toBe(false);
  });

  it('403 — «нет прав» (status 403), а не сбой и не пусто', async () => {
    const run = loreQueryRun({}, async () => json(403, { error: 'SCOPE_EMPTY', detail: 'вне ваших проектов' }));
    const e = await run('tasks_of_sprint | limit 1', new AbortController().signal).catch(x => x);
    expect(e).toBeInstanceOf(LiveBlockError);
    expect((e as LiveBlockError).status).toBe(403);
  });
});
