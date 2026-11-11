// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-26 — Главная админки «что требует внимания»
// (прототип docs/prototypes/s7b-admin-v6.html, экран «Главная»).
//
// Первое, что видно при входе в модуль: не «вся информация», а сломанное и
// недоделанное. Каждая карточка — число и кнопка в экран, который это чинит,
// уже с фильтром. Каждая карточка читает свой источник и честна отдельно:
// «0» — только когда источник ответил; 403 и сбой — своими словами.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AdminHome } from './HomeScreen';
import { agentsWithoutMachine, mcpFailureTotal, peopleWithoutProjects } from './home';
import { parseAgents } from './agents';
import { parseRoleMatrix } from './roles';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const AGENTS = [
  { actor_id: 'A1', name: 'Claude', client_id: 'c1', agent_role: 'full', machine_id: 'lorcetus', harness: 'claude-code', owner_kc_sub: ['u1'], owner_display_name: ['own'] },
  { actor_id: 'A2', name: 'Kimi', client_id: 'c2', agent_role: 'full', machine_id: null, harness: 'kimi-code', owner_kc_sub: ['u1'], owner_display_name: ['own'] },
  { actor_id: 'A3', name: 'Ci', client_id: 'c3', agent_role: 'ci', machine_id: '', harness: null, owner_kc_sub: ['u1'], owner_display_name: ['own'] },
];
const MATRIX = {
  rows: [
    { kc_sub: 'u1', display_name: 'own', state: 'checked', cells: [{ project: 'AIDA/p1', role: 'owner', state: 'checked', source: 'graph' }] },
    { kc_sub: 'u2', display_name: 'новенький', state: 'checked', cells: [] },
    // Строку не смогли проверить — «без проектов» про неё не утверждаем.
    { kc_sub: 'u3', display_name: 'туман', state: 'unavailable', cells: [] },
  ],
  sources_asked: ['graph'],
};
const FAIL = { rows: [{ caller: 'ci', failures: 2, last_failure: 1 }, { caller: 'full', failures: 1, last_failure: 2 }] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface FakeOpts { agents?: number; roles?: number; fail?: number; failBody?: unknown }
function fake(o: FakeOpts = {}) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/lore/slice/agent_owners')) return o.agents ? json({ error: 'FORBIDDEN', detail: 'admin only' }, o.agents) : json({ rows: AGENTS });
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [] });
    if (url.startsWith('/lore/slice/role_matrix')) return o.roles ? json({ error: 'DOWN', detail: 'graph down' }, o.roles) : json(MATRIX);
    if (url.startsWith('/lore/slice/mcp_connections')) return json({ rows: [{ caller: 'full', calls: 5, last_seen: 1 }] });
    if (url.startsWith('/lore/slice/mcp_failures')) return o.fail ? json({ error: 'DOWN', detail: 'metrics down' }, o.fail) : json(o.failBody ?? FAIL);
    return json({ rows: [] });
  }) as unknown as typeof fetch;
}

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><AdminHome fetchImpl={f} /></KitLangProvider>);

describe('S7B-26 · модель Главной', () => {
  it('без машины — machine_id пуст или null', () => {
    expect(agentsWithoutMachine(parseAgents({ rows: AGENTS } as never).rows).map(a => a.actor_id)).toEqual(['A2', 'A3']);
  });

  it('без проектов — только проверенные строки без ролей; «не смогли» не считаем', () => {
    expect(peopleWithoutProjects(parseRoleMatrix(MATRIX)).map(p => p.kc_sub)).toEqual(['u2']);
  });

  it('сбои MCP — сумма и число профилей; срез не прочитан — null, а не 0', () => {
    expect(mcpFailureTotal({ profiles: [
      { caller: 'a', calls: 1, lastSeen: 1, failures: 2, lastFailure: 1, health: 'live' },
      { caller: 'b', calls: 1, lastSeen: 1, failures: 0, lastFailure: null, health: 'live' },
      { caller: 'c', calls: null, lastSeen: null, failures: 1, lastFailure: 1, health: 'unseen' },
    ], failError: null, truncated: false })).toEqual({ n: 3, profiles: 2 });
    expect(mcpFailureTotal({ profiles: [], failError: 'HTTP 502', truncated: false })).toEqual({ n: null, profiles: 0 });
  });
});

describe('S7B-26 · экран Главной', () => {
  it('три карточки с числами: агенты без машины, сбои MCP, люди без проектов', async () => {
    mount(fake());
    const machine = await screen.findByTestId('adm-home-nomachine');
    expect(machine.getAttribute('data-n')).toBe('2');
    expect((await screen.findByTestId('adm-home-mcpfail')).getAttribute('data-n')).toBe('3');
    expect((await screen.findByTestId('adm-home-noprojects')).getAttribute('data-n')).toBe('1');
  });

  it('карточка ведёт в экран, который чинит, уже с фильтром: «без машины» → Агенты, adm-agents-f=nomachine', async () => {
    mount(fake());
    const card = await screen.findByTestId('adm-home-nomachine');
    fireEvent.click(await within(card).findByRole('button'));
    const qs = new URLSearchParams(window.location.search);
    expect(qs.get('adm')).toBe('agents');
    expect(qs.get('adm-agents-f')).toBe('nomachine');
  });

  it('сбои MCP → раздел MCP с фильтром; люди без проектов → Роли', async () => {
    mount(fake());
    fireEvent.click(await within(await screen.findByTestId('adm-home-mcpfail')).findByRole('button'));
    expect(new URLSearchParams(window.location.search).get('adm')).toBe('mcp');
    fireEvent.click(await within(await screen.findByTestId('adm-home-noprojects')).findByRole('button'));
    expect(new URLSearchParams(window.location.search).get('adm')).toBe('roles');
  });

  it('ноль — «в порядке», но только если источник ответил; кнопки «чинить» нет', async () => {
    mount(fake({ failBody: { rows: [] } }));
    const card = await screen.findByTestId('adm-home-mcpfail');
    await within(card).findByText(/в порядке/i);
    expect(card.getAttribute('data-n')).toBe('0');
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('403 у источника — «нет прав проверить», а не ноль', async () => {
    mount(fake({ agents: 403 }));
    const card = await screen.findByTestId('adm-home-nomachine');
    await within(card).findByText(/нет прав/i);
    expect(card.getAttribute('data-state')).toBe('forbidden');
    expect(card.getAttribute('data-n')).toBeNull();
  });

  it('сбой источника — «не смогли проверить» с причиной, остальные карточки живы', async () => {
    mount(fake({ roles: 502 }));
    const card = await screen.findByTestId('adm-home-noprojects');
    await within(card).findByText(/не смогли проверить/i);
    expect(card.getAttribute('data-state')).toBe('error');
    expect((await screen.findByTestId('adm-home-nomachine')).getAttribute('data-n')).toBe('2');
  });

  it('срез сбоев MCP не прочитан — «не смогли проверить», а не «в порядке»', async () => {
    mount(fake({ fail: 502 }));
    const card = await screen.findByTestId('adm-home-mcpfail');
    await within(card).findByText(/не смогли проверить/i);
    expect(within(card).queryByText(/в порядке/i)).toBeNull();
  });

  it('быстрый старт: частые намерения — одной кнопкой в нужный экран', async () => {
    mount(fake());
    const start = screen.getByTestId('adm-home-start');
    const btns = within(start).getAllByRole('button');
    expect(btns.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(within(start).getByTestId('adm-home-go-who'));
    expect(new URLSearchParams(window.location.search).get('adm')).toBe('who');
    fireEvent.click(within(start).getByTestId('adm-home-go-laptop'));
    expect(new URLSearchParams(window.location.search).get('adm-agents-f')).toBe('nomachine');
  });
});
