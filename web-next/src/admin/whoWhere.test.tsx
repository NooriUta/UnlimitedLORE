// @vitest-environment jsdom
// UC-8 «Кто где» (SPEC-ADMIN-LORE-UC 1.2.0): владелица 09.11 — «в скольких
// человек участвует, и со стороны проекта кто ты в нём и кто в нём твои агенты».
// Данные — role_matrix (projects/roles по позиции) + agent_owners (владелец
// массивом). Агент видит все проекты владельца — сборка на клиенте.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { WhoWhereScreen } from './WhoWhereScreen';
import { buildParticipation } from './participation';
import { parseAgents } from './agents';

beforeAll(() => { registerGameIcons(gameIcons); });
// Разворот живёт в адресе (?adm-by=…): без сброса он переезжает из теста в тест.
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const MATRIX = [
  { kc_sub: 'u-owner', display_name: 'omiloreadmin', projects: ['NooriUta/UnlimitedLORE', 'AIDA/miniLORE'], roles: ['owner', 'owner'] },
  { kc_sub: 'u-fro', display_name: 'frolova', projects: ['AIDA/miniLORE'], roles: ['reader'] },
];
const AGENTS = [
  { actor_id: 'AG-FULL', name: 'Claude Code (full)', client_id: 'lore-mcp-full', agent_role: 'full', harness: 'claude-code', owner_kc_sub: ['u-owner'], owner_display_name: ['omiloreadmin'] },
  { actor_id: 'AG-KIMI', name: 'Kimi (full)', client_id: 'lore-mcp-full_kimi', agent_role: 'full', harness: 'kimi-code', owner_kc_sub: ['u-owner'], owner_display_name: ['omiloreadmin'] },
  { actor_id: 'AG-LOST', name: 'Потерянный', client_id: 'x', agent_role: 'full', harness: null, owner_kc_sub: ['u-gone'], owner_display_name: ['gone'] },
];
const agents = () => parseAgents({ rows: AGENTS } as never).rows;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function fake(opts: { agentsFail?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/lore/slice/role_matrix')) return json({ rows: MATRIX });
    if (url.startsWith('/lore/slice/agent_owners')) return opts.agentsFail ? json({ error: 'DOWN' }, 502) : json({ rows: AGENTS });
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [] });
    return json({ rows: [] });
  }) as unknown as typeof fetch;
}

describe('UC-8 · модель', () => {
  it('человек: число проектов, роль в каждом, его агенты; первым — у кого больше проектов', () => {
    const p = buildParticipation(MATRIX, agents());
    expect(p.people[0].name).toBe('omiloreadmin');
    expect(p.people[0].projects).toEqual([{ slug: 'AIDA/miniLORE', role: 'owner' }, { slug: 'NooriUta/UnlimitedLORE', role: 'owner' }]);
    expect(p.people[0].agents.map(a => a.actor_id)).toEqual(['AG-FULL', 'AG-KIMI']);
    expect(p.people[1].agents).toEqual([]);
  });

  it('проект: люди с ролями и их агенты (агент видит все проекты владельца)', () => {
    const mini = buildParticipation(MATRIX, agents()).projects.find(x => x.slug === 'AIDA/miniLORE')!;
    expect(mini.members.map(m => [m.name, m.role])).toEqual([['frolova', 'reader'], ['omiloreadmin', 'owner']]);
    expect(mini.agentCount).toBe(2);
  });

  it('агент без владельца среди людей — отдельно, не теряется молча', () => {
    expect(buildParticipation(MATRIX, agents()).orphanAgents.map(a => a.actor_id)).toEqual(['AG-LOST']);
  });

  it('агенты не прочитались — люди и роли есть, причина сказана, агентов не выдумываем', () => {
    const p = buildParticipation(MATRIX, { error: 'HTTP 502' });
    expect(p.agentsError).toBe('HTTP 502');
    expect(p.people[0].agents).toEqual([]);
  });
});

describe('UC-8 · экран', () => {
  it('«Люди»: у человека «в N проектах» и его агенты', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} /></KitLangProvider>);
    const owner = await screen.findByTestId('adm-person-u-owner');
    expect(within(owner).getByTestId('adm-person-projects').textContent).toContain('2');
    expect(owner.textContent).toContain('Kimi (full)');
    expect(screen.getByTestId('adm-orphans').textContent).toContain('Потерянный');
  });

  it('«Проекты»: кто в проекте, роль, их агенты, и «вы: роль» для смотрящего', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} meSub="u-fro" /></KitLangProvider>);
    fireEvent.click(await screen.findByTestId('adm-by-projects'));
    const mini = await screen.findByTestId('adm-project-AIDA/miniLORE');
    expect(mini.textContent).toMatch(/вы: reader/);
    expect(mini.textContent).toContain('omiloreadmin');
    expect(mini.textContent).toContain('Claude Code (full)');
  });

  it('агенты упали — экран жив, плашка с причиной', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake({ agentsFail: true })} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-agents-error')).toBeTruthy();
    expect(screen.getByTestId('adm-person-u-owner')).toBeTruthy();
  });

  it('поиск: по имени человека, его проекту или агенту; запрос в адресе (adm-q), S7B-25', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} /></KitLangProvider>);
    const q = await screen.findByTestId('adm-who-q');
    fireEvent.change(q, { target: { value: 'FRO' } });
    expect(new URLSearchParams(window.location.search).get('adm-q')).toBe('FRO');
    expect(screen.getByTestId('adm-person-u-fro')).toBeTruthy();
    expect(screen.queryByTestId('adm-person-u-owner')).toBeNull();
    fireEvent.change(q, { target: { value: 'kimi' } });
    expect(screen.getByTestId('adm-person-u-owner')).toBeTruthy();
    expect(screen.queryByTestId('adm-person-u-fro')).toBeNull();
    fireEvent.change(q, { target: { value: 'unlimited' } });
    expect(screen.getByTestId('adm-person-u-owner')).toBeTruthy();
    expect(screen.queryByTestId('adm-person-u-fro')).toBeNull();
  });

  it('поиск в «Проектах»: по slug или участнику', async () => {
    window.history.replaceState(null, '', '/?adm-by=projects&adm-q=frolova');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-project-AIDA/miniLORE')).toBeTruthy();
    expect(screen.queryByTestId('adm-project-NooriUta/UnlimitedLORE')).toBeNull();
  });

  it('по запросу никого — «ничего не найдено» с кнопкой сброса, а не «людей нет»', async () => {
    window.history.replaceState(null, '', '/?adm-q=нетакого');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} /></KitLangProvider>);
    const empty = await screen.findByTestId('adm-who-nothing');
    expect(empty.textContent).toMatch(/нетакого/);
    fireEvent.click(within(empty).getByRole('button'));
    expect(new URLSearchParams(window.location.search).get('adm-q')).toBeNull();
    expect(screen.getByTestId('adm-person-u-owner')).toBeTruthy();
  });
});
