import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect, type Tool } from './writeToolHarness.js';

// SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05 (SPEC-LORE-GRAPH-SEARCH): поиск по графу в MCP.
// graph — раздельные фильтры walk_types/return_types и dir; graph_path — путь между двумя
// записями (GET /lore/graph/path); find — «тип + поля + связь» (POST /lore/find, чтение).
// Обёртки тонкие: параметры — как есть, ответ — целиком вместе с meta (found/reason,
// empty_reason, hidden_by_scope): «пути нет» и «скрыто скоупом» не должны по дороге
// превращаться в пустоту. Пять запросов приёмки из заметки задачи — каждый своим тестом.

const gets: { path: string; params?: Record<string, string> }[] = [];
const posts: { path: string; body: unknown }[] = [];
let answer: unknown = {};
let fail: Error | undefined;

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: 'NooriUta/UnlimitedLORE',
  loreGet: vi.fn(async (path: string, params?: Record<string, string>) => {
    gets.push({ path, params });
    if (fail) throw fail;
    return answer;
  }),
  lorePost: vi.fn(async (path: string, body: unknown) => {
    posts.push({ path, body });
    if (fail) throw fail;
    return answer;
  }),
  loreSlices: vi.fn(async () => ({ slices: [] })),
  loreSliceWithMeta: vi.fn(async () => ({ rows: [] })),
}));

const { registerLoreRead } = await import('./loreRead.js');

function tool(name: string): Tool {
  const t = collect(registerLoreRead).find((x) => x.name === name);
  if (!t) throw new Error(`${name} не зарегистрирован`);
  return t;
}

async function run(name: string, args: Record<string, unknown>) {
  const res = (await tool(name).handler(args)) as { content: { text: string }[]; isError?: boolean };
  return { text: res.content[0].text, isError: res.isError === true };
}

const OPEN = { field: 'status_category', op: '!=', value: ['finished', 'withdrawn'] };

beforeEach(() => {
  gets.length = 0;
  posts.length = 0;
  answer = {};
  fail = undefined;
});

describe('graph — раздельные фильтры и направление (GC-05)', () => {
  it('walk_types, return_types, dir уходят строками на GET /lore/graph', async () => {
    await run('graph', { type: 'adr', id: 'ADR-LORE-057', depth: 3, walk_types: 'task', return_types: 'adr', dir: 'in' });
    expect(gets).toEqual([{ path: '/lore/graph',
      params: { type: 'adr', id: 'ADR-LORE-057', depth: '3', walk_types: 'task', return_types: 'adr', dir: 'in' } }]);
  });

  it('dir вне in|out|both отбивается схемой инструмента', () => {
    const s = tool('graph').schema;
    expect(s.dir.safeParse('up').success).toBe(false);
    expect(s.dir.safeParse('in').success).toBe(true);
  });
});

describe('graph_path — путь между двумя записями', () => {
  it('from/to и фильтры — на GET /lore/graph/path', async () => {
    answer = { paths: [], meta: { found: true } };
    await run('graph_path', { from: 'adr:ADR-LORE-057', to: 'task:SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05',
      rels: 'JUSTIFIED_BY', walk_types: 'task', dir: 'both', max_depth: 6, k: 3, structural: false });
    expect(gets).toEqual([{ path: '/lore/graph/path', params: {
      from: 'adr:ADR-LORE-057', to: 'task:SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05', rels: 'JUSTIFIED_BY',
      walk_types: 'task', dir: 'both', max_depth: '6', k: '3', structural: 'false' } }]);
  });

  it('«пути нет» доходит с причиной и глубиной, а не пустым списком без объяснений', async () => {
    answer = { paths: [], meta: { found: false, reason: 'no_path', message: 'пути нет до глубины 4' } };
    const { text, isError } = await run('graph_path', { from: 'adr:A', to: 'adr:B' });
    expect(isError).toBe(false);
    const body = JSON.parse(text);
    expect(body.meta.found).toBe(false);
    expect(body.meta.reason).toBe('no_path');
    expect(body.meta.message).toContain('до глубины 4');
  });

  it('max_depth > 6 и k > 3 отбиваются схемой', () => {
    const s = tool('graph_path').schema;
    expect(s.max_depth.safeParse(7).success).toBe(false);
    expect(s.k.safeParse(4).success).toBe(false);
  });
});

describe('find — «тип + поля + связь», пять запросов приёмки', () => {
  it('1. поиск с мультифильтром: тип + текст + статус + проект + компонент + дата', async () => {
    const where = [
      { field: 'title', op: 'contains', value: 'граф' },
      { field: 'status_category', op: '=', value: ['in_progress'] },
      { field: 'project', op: '=', value: ['NooriUta/UnlimitedLORE'] },
      { field: 'component', op: '=', value: ['SEIDRKIT_GRAPH'] },
      { field: 'changed_at', op: '>=', value: '2026-11-01' },
    ];
    await run('find', { type: 'task', where });
    expect(posts).toEqual([{ path: '/lore/find', body: { type: 'task', where } }]);
  });

  it('2. все открытые задачи проекта', async () => {
    await run('find', { type: 'task', where: [OPEN], links_to: { id: 'project:NooriUta/UnlimitedLORE' } });
    expect(posts[0].body).toEqual({ type: 'task', where: [OPEN], links_to: { id: 'project:NooriUta/UnlimitedLORE' } });
  });

  it('3. все открытые спринты', async () => {
    await run('find', { type: 'sprint', where: [OPEN] });
    expect(posts[0].body).toEqual({ type: 'sprint', where: [OPEN] });
  });

  it('4. задачи по компоненту', async () => {
    await run('find', { type: 'task', links_to: { id: 'component:FORSETI', rels: ['TAGGED_WITH'] } });
    expect(posts[0].body).toEqual({ type: 'task', links_to: { id: 'component:FORSETI', rels: ['TAGGED_WITH'] } });
  });

  it('5. задачи по репозиторию', async () => {
    await run('find', { type: 'task', links_to: { id: 'repository:https://git.seidrstudio.pro/AIDA/UnlimitedLORE' } });
    expect(posts[0].body).toEqual({ type: 'task',
      links_to: { id: 'repository:https://git.seidrstudio.pro/AIDA/UnlimitedLORE' } });
  });

  it('проект из LORE_ACTIVE_PROJECT не подставляется — скоуп режет сервер', async () => {
    await run('find', { type: 'sprint' });
    expect(posts[0].body).toEqual({ type: 'sprint' });
  });

  it('пустой ответ из-за скоупа доходит с empty_reason, а не как «нет данных»', async () => {
    answer = { rows: [], meta: { complete: true, hidden_by_scope: 3, empty_reason: 'hidden_by_scope' } };
    const body = JSON.parse((await run('find', { type: 'task' })).text);
    expect(body.meta.empty_reason).toBe('hidden_by_scope');
    expect(body.meta.hidden_by_scope).toBe(3);
  });

  it('отказ бэкенда — ошибка инструмента, а не пустой список', async () => {
    fail = new Error('POST /lore/find → 400 {"error":"BAD_PARAMS","detail":"where: поле «nope» не из модели"}');
    const { text, isError } = await run('find', { type: 'task', where: [{ field: 'nope', op: '=', value: 1 }] });
    expect(isError).toBe(true);
    expect(text).toContain('BAD_PARAMS');
  });

  it('GC-05 21.11: схема find объявляет search, project (строка или список) и прежнее scope_projects', () => {
    const s = tool('find').schema;
    expect(s.search?.safeParse('граф поиск').success).toBe(true);
    expect(s.project?.safeParse('LORE').success).toBe(true);
    expect(s.project?.safeParse(['LORE', 'MINILORE']).success).toBe(true);
    expect(s.scope_projects?.safeParse(['NooriUta/UnlimitedLORE']).success).toBe(true);
  });

  it('GC-05 21.11: search + project одним вызовом уходят на бэкенд как есть (короткий код проекта)', async () => {
    await run('find', { type: 'task', search: 'граф', project: 'LORE', where: [OPEN] });
    expect(posts[0].body).toEqual({ type: 'task', search: 'граф', project: 'LORE', where: [OPEN] });
    await run('find', { type: 'task', project: ['LORE', 'MINILORE'] });
    expect(posts[1].body).toEqual({ type: 'task', project: ['LORE', 'MINILORE'] });
  });

  it('GC-05 21.11: прежнее имя scope_projects принимается, _warning бэкенда доходит до агента', async () => {
    answer = { rows: [], meta: { complete: true }, _warning: 'scope_projects — прежнее имя параметра проекта' };
    const body = JSON.parse((await run('find', { type: 'sprint', scope_projects: ['NooriUta/UnlimitedLORE'] })).text);
    expect(posts[0].body).toEqual({ type: 'sprint', scope_projects: ['NooriUta/UnlimitedLORE'] });
    expect(body._warning).toContain('scope_projects');
  });

  it('схема: неизвестный тип и оператор отбиваются до бэкенда, И/ИЛИ/НЕ проходят', () => {
    const s = tool('find').schema;
    expect(s.type.safeParse('nope').success).toBe(false);
    expect(s.where.safeParse([{ field: 'title', op: '~', value: 'x' }]).success).toBe(false);
    expect(s.where.safeParse([{ or: [{ field: 'effort_days', op: '>', value: 2 },
      { not: { field: 'effort_days', op: 'set' } }] }]).success).toBe(true);
  });
});
