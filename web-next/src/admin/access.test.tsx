// @vitest-environment jsdom
// Доступ в админке v2 (SPRINT_UXR_S7B_ADMIN):
//   • S7B-14 — «Все мои (N своих)» в карточке смотрящего: GET /lore/me/projects,
//     а не все проекты LORE; без ролей — честный ноль, 401 — «не проверено»;
//   • S7B-10 — «Эффективный доступ»: почему человек видит / не видит проект
//     (GET /lore/admin/access?kc_sub&project&realm_role) и кто видит проект
//     (GET /lore/admin/access?project);
//   • S7B-12 — у агента «Проекты (наследует от владельца)», у человека
//     «агенты видят ваши N» (GET /lore/admin/access/agents).
// Раскрытая строка и вопрос «почему» живут в адресе — ссылка открывает то же.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { WhoWhereScreen } from './WhoWhereScreen';
import { AgentsScreen } from './AgentsScreen';
import { parseAgentProjects, parseExplain, parsePersonAgents, parseWhoSees } from './access';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const MATRIX = [
  { kc_sub: 'u-owner', display_name: 'omiloreadmin', projects: ['NooriUta/UnlimitedLORE', 'AIDA/miniLORE'], roles: ['owner', 'owner'] },
  { kc_sub: 'u-fro', display_name: 'frolova', projects: ['AIDA/miniLORE'], roles: ['reader'] },
];
const AGENTS = [
  { actor_id: 'AG-FULL', name: 'Claude Code (full)', client_id: 'lore-mcp-full', agent_role: 'full', harness: 'claude-code', owner_kc_sub: ['u-owner'], owner_display_name: ['omiloreadmin'] },
  { actor_id: 'AG-LOST', name: 'Потерянный', client_id: 'lost-client', agent_role: 'full', harness: null, owner_kc_sub: [], owner_display_name: [] },
];

const EXPLAIN_SEES = {
  project: 'AIDA/miniLORE', realm_role: 'viewer', project_role: 'reader', scope_enforced: true,
  sees: true, can_write: false, agent_profiles: [],
  chain: ['роль realm «viewer» скоуп не обходит', 'роль в проекте AIDA/miniLORE — «reader»: проект виден', 'писать не может: роль «reader» — только чтение'],
  kc_sub: 'u-fro', projects_with_role: 1,
};
const EXPLAIN_NOT = {
  project: 'NooriUta/UnlimitedLORE', realm_role: null, project_role: null, scope_enforced: true,
  sees: false, can_write: false, agent_profiles: [],
  chain: ['роль realm «—» скоуп не обходит', 'в проекте NooriUta/UnlimitedLORE роли нет — проект не виден'],
  kc_sub: 'u-fro', projects_with_role: 1,
};
const WHO_SEES = {
  project: 'AIDA/miniLORE', scope_enforced: true, count: 2,
  people: [
    { kc_sub: 'u-fro', display_name: 'frolova', role: 'reader', can_write: false },
    { kc_sub: 'u-owner', display_name: 'omiloreadmin', role: 'owner', can_write: true },
  ],
  bypass_realm_roles: ['admin', 'superadmin'],
  note: 'видят: люди с ролью в проекте + роли realm из bypass_realm_roles',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface FakeOpts {
  explain?: unknown;
  explainStatus?: number;
  me?: unknown;
  meStatus?: number;
}

function fake(opts: FakeOpts = {}) {
  return vi.fn(async (url: string) => {
    const u = new URL(url, 'http://x');
    if (u.pathname === '/lore/slice/role_matrix') return json({ rows: MATRIX });
    if (u.pathname === '/lore/slice/agent_owners') return json({ rows: AGENTS });
    if (u.pathname === '/lore/slice/dictionary') return json({ rows: [] });
    if (u.pathname === '/lore/me/projects') {
      return json(opts.me ?? { ok: true, projects: [{ slug: 'a', role: 'owner' }, { slug: 'b', role: 'owner' }, { slug: 'c', role: 'reader' }], count: 3 }, opts.meStatus ?? 200);
    }
    if (u.pathname === '/lore/admin/access/agents') {
      if (u.searchParams.get('kc_sub') === 'u-owner') {
        return json({ kc_sub: 'u-owner', agents: [{ actor_id: 'AG-FULL', name: 'Claude Code (full)', client_id: 'lore-mcp-full' }], count: 1, visible_projects: 23 });
      }
      if (u.searchParams.get('kc_sub')) return json({ kc_sub: u.searchParams.get('kc_sub'), agents: [], count: 0, visible_projects: 1 });
      if (u.searchParams.get('client_id') === 'lore-mcp-full') {
        return json({ client_id: 'lore-mcp-full', owner_kc_sub: 'u-owner', visible: ['AIDA/miniLORE', 'NooriUta/UnlimitedLORE'], agent_scope: 'full', writable: ['NooriUta/UnlimitedLORE'], inherited_from: 'u-owner' });
      }
      return json({ client_id: u.searchParams.get('client_id'), owner_kc_sub: null, visible: [], agent_scope: 'full', writable: [], inherited_from: null, reason: 'у клиента нет владельца в графе (KnowActor kind=agent + OWNED_BY) — проекты не наследуются' });
    }
    if (u.pathname === '/lore/admin/access') {
      if (!u.searchParams.get('kc_sub')) return json(WHO_SEES);
      if (opts.explainStatus) return json({ error: 'FORBIDDEN', detail: 'admin only' }, opts.explainStatus);
      return json(opts.explain ?? EXPLAIN_SEES);
    }
    return json({ rows: [] });
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

const urls = (f: ReturnType<typeof fake>) => (f as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]));

describe('доступ · модели ответов сервера', () => {
  it('почему видит: итог, роль в проекте, цепочка — как прислал сервер', () => {
    const e = parseExplain(EXPLAIN_SEES);
    expect(e.sees).toBe(true);
    expect(e.can_write).toBe(false);
    expect(e.project_role).toBe('reader');
    expect(e.chain).toHaveLength(3);
  });

  it('ответ без поля sees — это сбой, а не «не видит»', () => {
    expect(() => parseExplain({ project: 'x', chain: [] })).toThrow();
  });

  it('кто видит проект: люди с ролью и признаком записи, роли realm в обход', () => {
    const w = parseWhoSees(WHO_SEES);
    expect(w.people.map(p => [p.name, p.role, p.can_write])).toEqual([['frolova', 'reader', false], ['omiloreadmin', 'owner', true]]);
    expect(w.bypass_realm_roles).toEqual(['admin', 'superadmin']);
  });

  it('агент: видит все проекты владельца, пишет — где делегирует профиль; без владельца — причина', () => {
    const a = parseAgentProjects({ client_id: 'c', owner_kc_sub: 'u', visible: ['b', 'a'], writable: ['a'], inherited_from: 'u' });
    expect(a.visible).toEqual(['a', 'b']);
    expect(a.writable).toEqual(['a']);
    const lost = parseAgentProjects({ client_id: 'c', owner_kc_sub: null, visible: [], writable: [], reason: 'нет владельца' });
    expect(lost.owner_kc_sub).toBeNull();
    expect(lost.reason).toBe('нет владельца');
  });

  it('человек: число агентов и «агенты видят N проектов»', () => {
    const p = parsePersonAgents({ agents: [{ actor_id: 'A' }], count: 1, visible_projects: 23 });
    expect(p.agents).toHaveLength(1);
    expect(p.visible_projects).toBe(23);
    expect(() => parsePersonAgents({ agents: [] })).toThrow();
  });
});

describe('S7B-14 · «Все мои (N своих)» в карточке смотрящего', () => {
  it('число своих — с /lore/me/projects, а не число всех проектов LORE', async () => {
    const f = fake();
    // S7B-28: подробности человека — в паспорте, он открывается из адреса (?adm-open=…).
    window.history.replaceState(null, '', '/?adm-open=u-owner');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={f} meSub="u-owner" /></KitLangProvider>);
    const chip = await screen.findByTestId('adm-my-projects');
    await vi.waitFor(() => expect(chip.textContent).toMatch(/Все мои \(3 своих\)/));
    expect(urls(f)).toContain('/lore/me/projects');
  });

  it('ролей нет — честный ноль, а не прочерк', async () => {
    // S7B-28: подробности человека — в паспорте, он открывается из адреса (?adm-open=…).
    window.history.replaceState(null, '', '/?adm-open=u-owner');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake({ me: { ok: true, projects: [], count: 0 } })} meSub="u-owner" /></KitLangProvider>);
    const chip = await screen.findByTestId('adm-my-projects');
    await vi.waitFor(() => expect(chip.textContent).toMatch(/Все мои \(0 своих\)/));
  });

  it('не опознан (401) — «не проверено», а не ноль', async () => {
    // S7B-28: подробности человека — в паспорте, он открывается из адреса (?adm-open=…).
    window.history.replaceState(null, '', '/?adm-open=u-owner');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake({ me: { error: 'NO_IDENTITY' }, meStatus: 401 })} meSub="u-owner" /></KitLangProvider>);
    const chip = await screen.findByTestId('adm-my-projects');
    await vi.waitFor(() => expect(chip.getAttribute('data-state')).toBe('error'));
    expect(chip.textContent).not.toMatch(/\(0 своих\)/);
    expect(chip.textContent).toMatch(/не смогли проверить/i);
  });

  it('в строке человека — «своих проектов», по его ролям', async () => {
    // S7B-28: подробности человека — в паспорте, он открывается из адреса (?adm-open=…).
    window.history.replaceState(null, '', '/?adm-open=u-fro');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} /></KitLangProvider>);
    const fro = await screen.findByTestId('adm-person-u-fro');
    expect(within(fro).getByTestId('adm-person-projects').textContent).toMatch(/своих проектов: 1/);
  });
});

describe('S7B-10 · эффективный доступ', () => {
  it('раскрытый человек (из адреса) с выбранным проектом — итог и цепочка сервера', async () => {
    window.history.replaceState(null, '', '/?adm-open=u-fro&adm-acc-p=AIDA%2FminiLORE&adm-acc-r=viewer');
    const f = fake();
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={f} /></KitLangProvider>);
    const verdict = await screen.findByTestId('adm-acc-verdict');
    await vi.waitFor(() => expect(verdict.getAttribute('data-sees')).toBe('true'));
    expect(verdict.textContent).toMatch(/видит/);
    expect(verdict.textContent).toMatch(/только чтение/);
    const chain = screen.getByTestId('adm-acc-chain');
    expect(chain.querySelectorAll('li')).toHaveLength(3);
    expect(chain.textContent).toContain('«reader»: проект виден');
    expect(urls(f).some(u => u.startsWith('/lore/admin/access?') && u.includes('kc_sub=u-fro') && u.includes('realm_role=viewer') && u.includes('project=AIDA%2FminiLORE'))).toBe(true);
  });

  it('не видит — итог «не видит» и причина из цепочки', async () => {
    window.history.replaceState(null, '', '/?adm-open=u-fro&adm-acc-p=NooriUta%2FUnlimitedLORE');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake({ explain: EXPLAIN_NOT })} /></KitLangProvider>);
    const verdict = await screen.findByTestId('adm-acc-verdict');
    await vi.waitFor(() => expect(verdict.getAttribute('data-sees')).toBe('false'));
    expect(verdict.textContent).toMatch(/не видит/);
    expect(screen.getByTestId('adm-acc-chain').textContent).toContain('роли нет');
  });

  it('403 на вопрос «почему» — «нет прав», а не «не видит»', async () => {
    window.history.replaceState(null, '', '/?adm-open=u-fro&adm-acc-p=AIDA%2FminiLORE');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake({ explainStatus: 403 })} /></KitLangProvider>);
    const box = await screen.findByTestId('adm-access');
    await vi.waitFor(() => expect(box.textContent).toMatch(/Нет прав/));
    expect(screen.queryByTestId('adm-acc-verdict')).toBeNull();
  });

  it('проект не выбран — подсказка, запроса «почему» нет', async () => {
    window.history.replaceState(null, '', '/?adm-open=u-fro');
    const f = fake();
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={f} /></KitLangProvider>);
    const box = await screen.findByTestId('adm-access');
    expect(box.textContent).toMatch(/Выберите проект/);
    expect(urls(f).some(u => u.startsWith('/lore/admin/access?'))).toBe(false);
  });

  it('раскрытый проект — «кто видит»: люди, роль, пишет ли, и роли realm в обход', async () => {
    // S7B-28: «Проекты» — свой раздел (view="projects"), ось больше не в адресе.
    window.history.replaceState(null, '', '/?adm-open=AIDA%2FminiLORE');
    render(<KitLangProvider lang="ru"><WhoWhereScreen view="projects" fetchImpl={fake()} /></KitLangProvider>);
    const who = await screen.findByTestId('adm-who-sees');
    await vi.waitFor(() => expect(who.textContent).toContain('frolova'));
    expect(who.textContent).toMatch(/только чтение/);
    expect(who.textContent).toMatch(/пишет/);
    expect(who.textContent).toContain('superadmin');
  });
});

describe('S7B-12 · скоуп агентов', () => {
  it('у человека — «агенты видят ваши N проектов»', async () => {
    window.history.replaceState(null, '', '/?adm-open=u-owner');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake()} meSub="u-owner" /></KitLangProvider>);
    const line = await screen.findByTestId('adm-agents-see');
    await vi.waitFor(() => expect(line.textContent).toMatch(/видят ваши 23 проект/));
  });

  it('у агента (раскрыт из адреса) — проекты с пометкой наследования и записи', async () => {
    window.history.replaceState(null, '', '/?adm-agent=AG-FULL');
    render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={fake()} /></KitLangProvider>);
    const panel = await screen.findByTestId('adm-agent-projects');
    await vi.waitFor(() => expect(panel.textContent).toMatch(/наследует от omiloreadmin/));
    expect(panel.textContent).toMatch(/Проекты · 2/);
    expect(within(panel).getByTestId('adm-agent-proj-NooriUta/UnlimitedLORE').textContent).toMatch(/пишет/);
    expect(within(panel).getByTestId('adm-agent-proj-AIDA/miniLORE').textContent).toMatch(/читает/);
  });

  it('агент без владельца — причина сервера словами, а не пустой список', async () => {
    window.history.replaceState(null, '', '/?adm-agent=AG-LOST');
    render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={fake()} /></KitLangProvider>);
    const panel = await screen.findByTestId('adm-agent-projects');
    await vi.waitFor(() => expect(panel.textContent).toMatch(/нет владельца/));
  });

  it('кнопка «Проекты» у агента пишет выбор в адрес', async () => {
    render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={fake()} /></KitLangProvider>);
    const btn = await screen.findByTestId('adm-agent-proj-btn-AG-FULL');
    btn.click();
    await vi.waitFor(() => expect(new URLSearchParams(window.location.search).get('adm-agent')).toBe('AG-FULL'));
    expect(await screen.findByTestId('adm-agent-projects')).toBeTruthy();
  });
});
