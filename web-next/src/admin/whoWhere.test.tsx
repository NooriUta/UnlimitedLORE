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
  // S7B-28: подробности человека — в паспорте; он открывается по строке или из адреса (?adm-open=…).
  it('«Люди»: у человека «в N проектах» и его агенты (паспорт)', async () => {
    window.history.replaceState(null, '', '/?adm-open=u-owner');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} /></KitLangProvider>);
    const owner = await screen.findByTestId('adm-person-u-owner');
    expect(within(owner).getByTestId('adm-person-projects').textContent).toContain('2');
    expect(owner.textContent).toContain('Kimi (full)');
    expect(screen.getByTestId('adm-orphans').textContent).toContain('Потерянный');
  });

  // S7B-28: «Проекты» — свой раздел меню (view="projects"), а не переключатель внутри экрана.
  it('«Проекты»: кто в проекте, роль, их агенты, и «вы: роль» для смотрящего', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen view="projects" fetchImpl={fake()} meSub="u-fro" /></KitLangProvider>);
    const mini = await screen.findByTestId('adm-project-AIDA/miniLORE');
    expect(mini.textContent).toMatch(/вы: reader/);
    expect(mini.textContent).toContain('omiloreadmin');
    expect(mini.textContent).toContain('Claude Code (full)');
  });

  it('агенты упали — экран жив, плашка с причиной', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake({ agentsFail: true })} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-agents-error')).toBeTruthy();
    expect(document.querySelector('[data-record-id="u-owner"]')).toBeTruthy();
  });

  // S7B-28: поиск — строкой списка kit; ищет, как раньше (S7B-25), по имени, логину, проекту и агенту
  // (доп. текст поиска записи). Запрос — в адресе (параметр списка lt).
  it('поиск: по имени человека, его проекту или агенту; запрос в адресе', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} /></KitLangProvider>);
    await screen.findByRole('button', { name: 'omiloreadmin' });
    const rows = () => [...document.querySelectorAll('[data-record-id]')].map(e => e.getAttribute('data-record-id'));
    const q = screen.getByRole('searchbox');
    fireEvent.change(q, { target: { value: 'FRO' } });
    expect(new URLSearchParams(window.location.search).get('lt')).toBe('FRO');
    expect(rows()).toEqual(['u-fro']);
    fireEvent.change(q, { target: { value: 'kimi' } });
    expect(rows()).toEqual(['u-owner']);
    fireEvent.change(q, { target: { value: 'unlimited' } });
    expect(rows()).toEqual(['u-owner']);
  });

  it('поиск в «Проектах»: по slug или участнику', async () => {
    window.history.replaceState(null, '', '/?adm-q=frolova');
    render(<KitLangProvider lang="ru"><WhoWhereScreen view="projects" fetchImpl={fake()} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-project-AIDA/miniLORE')).toBeTruthy();
    expect(screen.queryByTestId('adm-project-NooriUta/UnlimitedLORE')).toBeNull();
  });

  it('старая ссылка ?adm-q=… открывает ту же выборку; по запросу никого — строк нет, а не «людей нет»', async () => {
    window.history.replaceState(null, '', '/?adm-q=нетакого');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} /></KitLangProvider>);
    expect(((await screen.findByRole('searchbox')) as HTMLInputElement).value).toBe('нетакого');
    expect(document.querySelectorAll('[data-record-id]').length).toBe(0);
    expect(screen.queryByText('Ролей в проектах пока нет')).toBeNull();
  });

  // S7B-28: два раздела вместо переключателя — у каждого свой заголовок, оба наполнены,
  // переключателя «Люди / Проекты» внутри экрана больше нет (его место — меню).
  it('«Люди и их проекты» — заголовок раздела, люди, агенты без владельца; переключателя оси нет', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} meSub="u-owner" /></KitLangProvider>);
    const row = await screen.findByRole('button', { name: /omiloreadmin/ });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Люди и их проекты');
    expect(row.textContent).toMatch(/это вы/);
    expect(screen.getByTestId('adm-orphans').textContent).toContain('Потерянный');
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.queryByTestId('adm-by-projects')).toBeNull();
    expect(screen.queryByTestId('adm-projects')).toBeNull();
  });

  it('«Проекты» — заголовок раздела, проекты, поиск, агенты без владельца; людей списком нет', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen view="projects" fetchImpl={fake()} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-project-AIDA/miniLORE')).toBeTruthy();
    expect(screen.getByTestId('adm-project-NooriUta/UnlimitedLORE')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Проекты');
    expect(screen.getByTestId('adm-orphans').textContent).toContain('Потерянный');
    expect(screen.getByTestId('adm-who-q')).toBeTruthy();
    expect(screen.queryByTestId('adm-by-people')).toBeNull();
    expect(screen.queryByTestId('adm-people')).toBeNull();
  });

  it('старый параметр оси ?adm-by=projects на экране «Люди» не переключает его тайком', async () => {
    window.history.replaceState(null, '', '/?adm-by=projects');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} /></KitLangProvider>);
    expect(await screen.findByRole('button', { name: 'omiloreadmin' })).toBeTruthy();
    expect(screen.queryByTestId('adm-projects')).toBeNull();
  });
});
