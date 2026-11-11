// @vitest-environment jsdom
// Вкладка «Граф» паспорта на серверном GET /lore/graph (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04,
// клиент). Сквозная проверка: от ответа сервера до экрана — урок 11.11 (загрузчик backlinks
// был «написан и покрыт тестами», но в приложении не вызывался нигде).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, TechVisibilityProvider } from '@seidr/kit';
import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => window.history.replaceState(null, '', '/?tab=graph&gdepth=2'));
afterEach(() => window.history.replaceState(null, '', '/'));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const FACADE = {
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SP', title: 'Спринт SP', status: 'active', version: 'v1' },
  values: { title: 'Спринт SP' },
  parts: [],
  links: [{ rel: 'HAS_TASK', dir: 'out', id: 'SP/A-1', type: 'task', title: 'Задача А', status: 'done' }],
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  schema: {
    type: 'sprint', label: 'Спринт', label_key: 'rec.sprint', icon: 'calendar',
    fields: [{ key: 'title', label: 'Название', label_key: 'f.t', kind: 'text', group: 'head', required: true, editable: false, write: null }],
    layout: {}, relations: [{ key: 'tasks', label: 'Задачи', relation: 'aggregation', rel: 'HAS_TASK', dir: 'out', target_type: 'task', place: 'link_tab', manageable: false }],
  },
  meta: { facade: 'server', sources: {}, data_state: [] },
};

const GRAPH = {
  nodes: [
    { id: 'SP', type: 'sprint', title: 'Спринт SP', status: 'active', status_category: 'in_progress', depth: 0 },
    { id: 'SP/A-1', type: 'task', title: 'Задача А', status: 'done', status_category: 'done', depth: 1 },
    { id: 'ADR-DEEP', type: 'adr', title: 'ADR второго шага', status: null, status_category: null, depth: 2 },
  ],
  edges: [
    { from: 'SP', rel: 'HAS_TASK', to: 'SP/A-1' },
    { from: 'SP/A-1', rel: 'JUSTIFIED_BY', to: 'ADR-DEEP' },
  ],
  meta: { mode: 'neighborhood', depth: 2, complete: true, truncated: false, capped_at: null, hidden_by_scope: 2, dangling: [], frontier_edges: 'not_read' },
};

function net(graphReply: () => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lore.test');
    if (url.pathname.startsWith('/lore/record/')) return json(FACADE);
    if (url.pathname === '/lore/graph') return graphReply();
    if (url.pathname === '/lore/history') return json({ type: 'sprint', id: 'SP', rows: [], attribution: { ok: true } });
    if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
    return json({ rows: [] });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const show = (f: typeof fetch) => render(
  <TechVisibilityProvider show={false}>
    <ListPassport type="sprint" id="SP" placement="bottom" fetchImpl={f} backLabel="Спринты" onBack={() => {}} />
  </TechVisibilityProvider>,
);

describe('GC-04 · вкладка «Граф» на /lore/graph', () => {
  it('запрос уходит с глубиной из адреса; второй шаг (ADR через задачу) — на экране', async () => {
    const f = net(() => json(GRAPH));
    show(f);
    await waitFor(() => expect(f.mock.calls.some(c => String(c[0]).startsWith('/lore/graph?type=sprint&id=SP&depth=2'))).toBe(true), { timeout: 8000 });
    // Узел второго шага — в секторах вкладки (data-node), его не было в фасаде.
    await waitFor(() => expect(document.querySelector('[data-node="ADR-DEEP"]')).not.toBeNull(), { timeout: 8000 });
  }, 15000);

  it('что граф не показывает — словами под легендой: края не прочитаны, скрыто правами', async () => {
    show(net(() => json(GRAPH)));
    const notes = await screen.findByTestId('kit-graph-notes', {}, { timeout: 8000 });
    expect(notes.textContent).toMatch(/на краю \(глубина 2\)/);
    expect(notes.textContent).toMatch(/Скрыто правами: 2/);
  }, 15000);

  it('сервер графа отказал — сказано словами, прямые связи фасада остаются', async () => {
    show(net(() => json({ error: 'OUTSIDE_SCOPE', detail: 'вне проектов' }, 403)));
    const notes = await screen.findByTestId('kit-graph-notes', {}, { timeout: 8000 });
    expect(notes.textContent).toMatch(/не загрузился.*403 OUTSIDE_SCOPE/);
    expect(document.querySelector('[data-node="SP/A-1"]')).not.toBeNull();
    expect(document.querySelector('[data-node="ADR-DEEP"]')).toBeNull();
  }, 15000);
});
