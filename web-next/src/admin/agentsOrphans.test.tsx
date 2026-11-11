// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-16 — находки детектора осиротевших агентов в разделе
// «Агенты»; SPRINT_UXR_S7B_ADMIN/S7B-04 — в карточке агента «почему видит».
//
// Детектор (сервер, AL-83/ADR-LORE-036): GET /lore/kc/agent-orphans — клиенты
// Keycloak с сервисной учёткой, у которых нет агента в графе
// (KnowActor.client_id): AL-68 не выведет им проектную роль вовсе. Ответ
// {orphans:[{clientId,id,enabled}]}; KC не настроен — 503 KC_NOT_CONFIGURED;
// KC упал — 502 KC_UPSTREAM; не admin — 403. Вторая сторона — агенты в графе
// без владельца (agent_owners без OWNED_BY): им не от кого наследовать проекты.
//
// Честные состояния: «сирот нет» — только когда KC ответил; 403 / «не настроен» /
// сбой — разными словами, ни одно не выглядит как «сирот нет».
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AgentsScreen } from './AgentsScreen';
import { agentWhy, graphOrphans, parseAgentOrphans, parseAgents } from './agents';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const ROWS = [
  { actor_id: 'A1', name: 'Claude Code (full)', client_id: 'lore-mcp-full', agent_role: 'full', machine_id: 'lorcetus', session_id: null, harness: 'claude-code', owner_kc_sub: ['u1'], owner_display_name: ['omiloreadmin'] },
  { actor_id: 'A3', name: 'Ничейный', client_id: 'lore-mcp-ro', agent_role: 'reader', machine_id: null, session_id: null, harness: null, owner_kc_sub: [], owner_display_name: [] },
  { actor_id: 'A4', name: 'Без учётки', client_id: null, agent_role: null, machine_id: null, session_id: null, harness: null, owner_kc_sub: ['u1'], owner_display_name: ['omiloreadmin'] },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fake(orphans: { status?: number; body?: unknown } = {}) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string) => {
    calls.push(url);
    if (url.startsWith('/lore/kc/agent-orphans')) {
      return json(orphans.body ?? { orphans: [{ clientId: 'lore-mcp-pm_laptop', id: 'k1', enabled: true }, { clientId: 'lore-mcp-old', id: 'k2', enabled: false }] }, orphans.status ?? 200);
    }
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [] });
    if (url.startsWith('/lore/admin/access/agents')) return json({ client_id: 'lore-mcp-full', owner_kc_sub: 'u1', visible: ['AIDA/p01'], writable: [], inherited_from: 'u1', reason: null });
    return json({ rows: ROWS });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={f} /></KitLangProvider>);

describe('S7B-16 · модель находок детектора', () => {
  it('ответ детектора разбирается; без поля orphans — сбой, а не «сирот нет»', () => {
    expect(parseAgentOrphans({ orphans: [{ clientId: 'c1', id: 'k1', enabled: false }] }))
      .toEqual([{ clientId: 'c1', id: 'k1', enabled: false }]);
    expect(() => parseAgentOrphans({})).toThrow();
  });

  it('сироты графа — агенты без владельца', () => {
    const d = parseAgents({ rows: ROWS } as never);
    expect(graphOrphans(d.rows).map(r => r.actor_id)).toEqual(['A3']);
  });
});

describe('S7B-16 · раздел «Агенты»: находки детектора', () => {
  it('KC ответил — клиенты без агента названы поимённо, выключенный помечен', async () => {
    mount(fake().f);
    const box = await screen.findByTestId('adm-orphans-kc');
    expect(await within(box).findByTestId('adm-orphan-kc-lore-mcp-pm_laptop')).toBeTruthy();
    expect(within(box).getByTestId('adm-orphan-kc-lore-mcp-old').getAttribute('data-enabled')).toBe('false');
  });

  it('KC ответил пустым списком — «сирот нет (проверено)»', async () => {
    mount(fake({ body: { orphans: [] } }).f);
    expect(await screen.findByTestId('adm-orphans-kc-none')).toBeTruthy();
  });

  it('403 — «нет прав», а не «сирот нет»', async () => {
    mount(fake({ status: 403, body: { error: 'FORBIDDEN', detail: 'admin only' } }).f);
    expect(await screen.findByTestId('adm-orphans-kc-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('adm-orphans-kc-none')).toBeNull();
  });

  it('KC не настроен (503) — названо отдельно от сбоя', async () => {
    mount(fake({ status: 503, body: { error: 'KC_NOT_CONFIGURED', detail: 'kc integration not configured' } }).f);
    expect(await screen.findByTestId('adm-orphans-kc-unconfigured')).toBeTruthy();
    expect(screen.queryByTestId('adm-orphans-kc-none')).toBeNull();
  });

  it('KC упал (502) — «не смогли спросить» с причиной', async () => {
    mount(fake({ status: 502, body: { error: 'KC_UPSTREAM', detail: 'connect timed out' } }).f);
    const err = await screen.findByTestId('adm-orphans-kc-error');
    expect(err.textContent).toContain('connect timed out');
  });

  it('агенты без владельца в графе названы поимённо', async () => {
    mount(fake().f);
    const box = await screen.findByTestId('adm-orphans-graph');
    expect(within(box).getByText('Ничейный')).toBeTruthy();
    expect(within(box).queryByText('Claude Code (full)')).toBeNull();
  });
});

describe('S7B-04 · карточка агента: почему видит', () => {
  it('модель: наследует от владельца / нет владельца / нет учётки', () => {
    const d = parseAgents({ rows: ROWS } as never);
    expect(agentWhy(d.rows[0])).toEqual({ kind: 'inherits', owner: 'omiloreadmin', scope: 'full' });
    expect(agentWhy(d.rows[1])).toEqual({ kind: 'noowner' });
    expect(agentWhy(d.rows[2])).toEqual({ kind: 'noclient' });
  });

  it('раскрытая карточка агента объясняет, почему он видит проекты', async () => {
    mount(fake().f);
    fireEvent.click(await screen.findByTestId('adm-agent-proj-btn-A1'));
    const why = await screen.findByTestId('adm-agent-why');
    expect(why.getAttribute('data-why')).toBe('inherits');
    expect(why.textContent).toContain('omiloreadmin');
    expect(why.textContent).toContain('full');
  });

  it('агент без владельца — «не видит ничего: наследовать не от кого»', async () => {
    mount(fake().f);
    fireEvent.click(await screen.findByTestId('adm-agent-proj-btn-A3'));
    expect((await screen.findByTestId('adm-agent-why')).getAttribute('data-why')).toBe('noowner');
  });
});
