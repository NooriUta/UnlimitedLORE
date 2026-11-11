// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-30 — карточка Главной и экран, куда она ведёт, сходятся 1:1.
//
// Дефект: карточка «N отказов ≥ 400» считала СОБЫТИЯ (count(*) по mcp_failures), а
// экран MCP показывал только свёртку «профиль — число», и самих отказов не было
// видно нигде. Владелица: «146 отказов… на следующем экране не отображаются — он пустой».
// Правило (обобщение): карточка «требует внимания» ведёт в экран С ТЕМ ЖЕ отбором,
// и экран показывает ровно те строки, что посчитала карточка; ноль — явное «нет»,
// не прочитали — «не смогли», а не пустота.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AdminHome } from './HomeScreen';
import { McpScreen } from './McpScreen';
import { RolesScreen } from './RolesScreen';
import { parseFailureRows } from './mcp';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const FAIL = { rows: [{ caller: 'full', failures: 3, last_failure: NOW - 1000 }, { caller: 'pm', failures: 1, last_failure: NOW - 5000 }] };
const FAIL_ROWS = {
  rows: [
    { ts: NOW - 1000, family: 'task', entity_id: 'SPRINT_X/T-1', caller: 'full', status: 405 },
    { ts: NOW - 2000, family: 'sprint', entity_id: 'SPRINT_X', caller: 'full', status: 409 },
    { ts: NOW - 3000, family: 'task', entity_id: 'SPRINT_X/T-2', caller: 'full', status: 400 },
    { ts: NOW - 5000, family: 'adr', entity_id: 'ADR-1', caller: 'pm', status: 403 },
  ],
};
const MATRIX = {
  rows: [
    { kc_sub: 'u1', display_name: 'own', state: 'checked', cells: [{ project: 'AIDA/p1', role: 'owner', state: 'checked', source: 'graph' }] },
    { kc_sub: 'u2', display_name: 'новенький', state: 'checked', cells: [] },
    { kc_sub: 'u3', display_name: 'туман', state: 'unavailable', cells: [] },
  ],
  sources_asked: ['graph'],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Opts { fail?: unknown; rows?: unknown; rowsStatus?: number }
function fake(o: Opts = {}) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/lore/slice/agent_owners')) return json({ rows: [] });
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [] });
    if (url.startsWith('/lore/slice/role_matrix')) return json(MATRIX);
    if (url.startsWith('/lore/slice/mcp_connections')) return json({ rows: [{ caller: 'full', calls: 50, last_seen: NOW - 60_000 }] });
    if (url.startsWith('/lore/slice/mcp_failure_rows')) return json(o.rows ?? FAIL_ROWS, o.rowsStatus ?? 200);
    if (url.startsWith('/lore/slice/mcp_failures')) return json(o.fail ?? FAIL);
    return json({ rows: [] });
  }) as unknown as typeof fetch;
}

const ru = (n: React.ReactNode) => <KitLangProvider lang="ru">{n}</KitLangProvider>;

describe('S7B-30 · отказы: карточка ↔ экран', () => {
  it('карточка ведёт в MCP с отбором «отказы», и экран показывает ровно столько строк-отказов, сколько посчитала карточка', async () => {
    const f = fake();
    const home = render(ru(<AdminHome fetchImpl={f} />));
    const card = await screen.findByTestId('adm-home-mcpfail');
    await within(card).findByRole('button');
    const n = Number(card.getAttribute('data-n'));
    expect(n).toBe(4);
    fireEvent.click(within(card).getByRole('button'));
    const qs = new URLSearchParams(window.location.search);
    expect(qs.get('adm')).toBe('mcp');
    expect(qs.get('adm-mcp-f')).toBe('failures');
    home.unmount();

    render(ru(<McpScreen fetchImpl={f} now={NOW} />));
    const list = await screen.findByTestId('adm-mcp-fails-table');
    expect(within(list).getAllByTestId(/^adm-mcp-fail-row-/)).toHaveLength(n);
    const first = within(list).getByTestId('adm-mcp-fail-row-0');
    expect(first.textContent).toContain('405');
    expect(first.textContent).toContain('SPRINT_X/T-1');
    expect(first.textContent).toContain('task');
    expect(screen.getByTestId('adm-mcp-fails-count').textContent).toMatch(/4 из 4/);
  });

  it('отбор «отказы» в адресе сужает профили до тех, у кого отказы есть', async () => {
    window.history.replaceState(null, '', '/?adm=mcp&adm-mcp-f=failures');
    render(ru(<McpScreen fetchImpl={fake({ fail: { rows: [{ caller: 'pm', failures: 1, last_failure: NOW }] }, rows: { rows: [FAIL_ROWS.rows[3]] } })} now={NOW} />));
    const table = await screen.findByTestId('adm-mcp');
    expect(within(table).queryByTestId('adm-mcp-full')).toBeNull();
    expect(within(table).getByTestId('adm-mcp-pm')).toBeTruthy();
    expect(screen.getByTestId('adm-mcp-only-failures').getAttribute('aria-pressed')).toBe('true');
  });

  it('отказов нет — явное «отказов нет», а не пустой экран', async () => {
    render(ru(<McpScreen fetchImpl={fake({ fail: { rows: [] }, rows: { rows: [] } })} now={NOW} />));
    const empty = await screen.findByTestId('adm-mcp-fails-empty');
    expect(empty.textContent).toMatch(/отказов нет/i);
  });

  it('список отказов не прочитался — «не смогли», а не «отказов нет»', async () => {
    render(ru(<McpScreen fetchImpl={fake({ rows: { error: 'BAD_SLICE', detail: 'unknown slice' }, rowsStatus: 400 })} now={NOW} />));
    const err = await screen.findByTestId('adm-mcp-fails-error');
    expect(err.textContent).toMatch(/не смогли/i);
    expect(screen.queryByTestId('adm-mcp-fails-empty')).toBeNull();
  });

  it('строк меньше, чем насчитано, — честно «показаны N из M», а не молча часть', async () => {
    render(ru(<McpScreen fetchImpl={fake({ rows: { rows: FAIL_ROWS.rows.slice(0, 2), truncated: true } })} now={NOW} />));
    await screen.findByTestId('adm-mcp-fails-table');
    const note = screen.getByTestId('adm-mcp-fails-count');
    expect(note.textContent).toMatch(/2 из 4/);
    expect(note.getAttribute('data-tone')).toBe('wrn');
  });

  it('время отказа принимается и числом epoch-мс, и ISO-строкой', () => {
    const rows = parseFailureRows([
      { ts: 1_762_860_000_000, caller: 'full', status: 400 },
      { ts: '2026-11-11T10:35:04.199Z', caller: 'full', status: '405' },
      { ts: null, caller: 'full', status: 409 },
    ]);
    expect(rows.map(r => r.ts)).toEqual([1_762_860_000_000, Date.parse('2026-11-11T10:35:04.199Z'), null]);
    expect(rows[1].status).toBe(405);
  });
});

describe('S7B-30 · соседняя карточка «люди без проектов» той же болезни', () => {
  it('карточка ведёт в Роли с отбором, и экран показывает ровно тех людей, что посчитала карточка', async () => {
    const f = fake();
    const home = render(ru(<AdminHome fetchImpl={f} />));
    const card = await screen.findByTestId('adm-home-noprojects');
    await within(card).findByRole('button');
    const n = Number(card.getAttribute('data-n'));
    fireEvent.click(within(card).getByRole('button'));
    const qs = new URLSearchParams(window.location.search);
    expect(qs.get('adm')).toBe('roles');
    expect(qs.get('adm-roles-f')).toBe('noprojects');
    home.unmount();

    render(ru(<RolesScreen fetchImpl={f} />));
    await screen.findByTestId('adm-roles-person-u2');
    expect(screen.queryByTestId('adm-roles-person-u1')).toBeNull();
    expect(screen.queryByTestId('adm-roles-person-u3')).toBeNull();
    expect(screen.getAllByTestId(/^adm-roles-person-/)).toHaveLength(n);
    expect(screen.getByTestId('adm-roles-only-noprojects').getAttribute('aria-pressed')).toBe('true');
  });
});
