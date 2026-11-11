// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-17 — мастера UC-1 «подключить человека», UC-2 «дать
// человеку агента», UC-7 «новый ноутбук» из готовых элементов kit (Steps ·
// SecretOnce · DiffPreview · BatchUndo). Прототип: docs/prototypes/s7b-admin-v6.html.
//
// Сервер (всё уже есть, мастер только собирает):
//   GET  /lore/kc/users                 → [{id, username, email, enabled, roles}]
//   POST /lore/kc/user {username,email} → {ok, username, note}
//   GET  /lore/slice/role_matrix        → люди и их роли в проектах («как у похожего»)
//   POST /lore/user/role/batch          → dry_run-дифф и пачка (DangerBatch)
//   GET  /lore/kc/agents                → клиенты KC; шаблоны профилей — lore-mcp-<профиль>
//   POST /lore/kc/agent-client {profile, machine} → {clientId, secret, roles_copied}; 409 EXISTS
//   POST /lore/actor {actor_id, name, kind:agent} + POST /lore/actor/owner {…, machine_id}
//   GET  /lore/slice/agent_owners, agent_sessions → проверка «заработало»
//
// Правила, которые здесь держатся:
//   • секрет — только в SecretOnce: не в адресе, не в .mcp.json на экране, не в команде;
//   • проверка «заработало» говорит, ЧТО она видит (запись/сессию с машины), и не
//     выдаёт молчание за «работает»;
//   • имя машины, занятое чужой машиной, — отказ с именем владельца;
//   • то, что админка сделать не может, — блок «осталось руками».
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import {
  agentClientIdOf, findKcUser, firstCallOf, likeChanges, machineProblem, machineTakenBy,
  mcpAddCommand, mcpJsonText, parseKcUsers, templateProfiles,
} from './wizards';
import { parseRoleMatrix } from './roles';
import { parseAgents } from './agents';
import { WizardsScreen } from './WizardsScreen';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* нет хранилища */ }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const cell = (project: string, role: string, state = 'checked') => ({ project, role, state, source: 'graph' });
const MATRIX = {
  rows: [
    { kc_sub: 'u-me', display_name: 'omiloreadmin', state: 'checked', cells: [cell('NooriUta/UnlimitedLORE', 'owner'), cell('AIDA/miniLORE', 'owner')] },
    { kc_sub: 'u-volva', display_name: 'volva', state: 'checked', cells: [
      cell('NooriUta/UnlimitedLORE', 'developer'), cell('AIDA/miniLORE', 'developer'), cell('NooriUta/volva', 'owner'),
      cell('AIDA/unknown', 'reader', 'unavailable'),
    ] },
  ],
  sources_asked: ['graph'],
};
const KC_USERS = [
  { id: 'u-me', username: 'omiloreadmin', email: 'admin@seidr.test', enabled: true, roles: ['admin'] },
  { id: 'u-anna', username: 'anna', email: 'Anna@Seidr.test', enabled: true, roles: ['lore-user'] },
];
const KC_AGENTS = [
  { clientId: 'lore-mcp-full', id: 'c1', enabled: true, agent_scope: ['full'] },
  { clientId: 'lore-mcp-developer', id: 'c2', enabled: true, agent_scope: ['developer'] },
  { clientId: 'lore-mcp-full_desk', id: 'c3', enabled: true, agent_scope: ['full'] },
  { clientId: 'lore-app', id: 'c4', enabled: true, agent_scope: [] },
];
const OWNERS = {
  rows: [
    { actor_id: 'lore-mcp-full_desk', client_id: 'lore-mcp-full_desk', agent_role: 'full', machine_id: 'desk', owner_kc_sub: ['u-me'], owner_display_name: ['omiloreadmin'] },
    { actor_id: 'lore-mcp-full_volvabox', client_id: 'lore-mcp-full_volvabox', agent_role: 'full', machine_id: 'volvabox', owner_kc_sub: ['u-volva'], owner_display_name: ['volva'] },
  ],
};
const SECRET = 'lore-secret-ONCE-0001';

// ── модель ────────────────────────────────────────────────────────────────

describe('модель · учётка KC', () => {
  it('ищется по логину или почте без учёта регистра; пустой запрос — не «не найдена»', () => {
    const users = parseKcUsers(KC_USERS);
    expect(findKcUser(users, 'anna@seidr.TEST')?.id).toBe('u-anna');
    expect(findKcUser(users, ' ANNA ')?.id).toBe('u-anna');
    expect(findKcUser(users, 'boris')).toBeNull();
    expect(findKcUser(users, '  ')).toBeUndefined();
  });

  it('ответ не массив — сбой, а не «никого нет»', () => {
    expect(() => parseKcUsers({ error: 'x' })).toThrow();
  });
});

describe('модель · проекты «как у похожего»', () => {
  const data = parseRoleMatrix(MATRIX);
  it('берутся проверенные роли похожего; снятая галочка не копируется; роль можно сменить', () => {
    const ch = likeChanges(data, 'u-volva', new Set(['NooriUta/volva']), { 'AIDA/miniLORE': 'reader' });
    expect(ch).toEqual([
      { project: 'AIDA/miniLORE', role: 'reader' },
      { project: 'NooriUta/UnlimitedLORE', role: 'developer' },
    ]);
  });
  it('непроверенная ячейка не копируется молча — её нет в пачке', () => {
    const ch = likeChanges(data, 'u-volva', new Set(), {});
    expect(ch.map(c => c.project)).not.toContain('AIDA/unknown');
  });
  it('похожий не найден — пачка пуста', () => {
    expect(likeChanges(data, 'nobody', new Set(), {})).toEqual([]);
  });
});

describe('модель · профили и машина', () => {
  it('профили — шаблоны lore-mcp-<профиль>; машинные клиенты и чужие — не профили', () => {
    expect(templateProfiles(KC_AGENTS)).toEqual(['developer', 'full']);
  });
  it('имя клиента — как у сервера: lore-mcp-<профиль>_<машина>', () => {
    expect(agentClientIdOf('full', 'huawei-matebook')).toBe('lore-mcp-full_huawei-matebook');
  });
  it('имя машины: латиница, цифры, . _ -; иначе причина словами', () => {
    expect(machineProblem('huawei-matebook')).toBeNull();
    expect(machineProblem('')).toMatch(/.+/);
    expect(machineProblem('ноут')).toMatch(/.+/);
    expect(machineProblem('-x')).toMatch(/.+/);
  });
  it('машина занята чужим агентом — называется владелец; своя — не отказ', () => {
    const rows = parseAgents(OWNERS).rows;
    expect(machineTakenBy(rows, 'volvabox', 'u-me')).toBe('volva');
    expect(machineTakenBy(rows, 'desk', 'u-me')).toBeNull();
    expect(machineTakenBy(rows, 'new-one', 'u-me')).toBeNull();
  });
});

describe('модель · конфиг MCP без секрета', () => {
  const cfg = { backend: 'https://lore.example/_backend', issuer: 'https://kc.example/realms/omilore', clientId: 'lore-mcp-full_nb', machine: 'nb' };
  it('.mcp.json — stdio-сервер с переменными; секрет — ссылкой на переменную окружения', () => {
    const j = JSON.parse(mcpJsonText(cfg)) as { mcpServers: Record<string, { env: Record<string, string> }> };
    const env = j.mcpServers['aida-lore'].env;
    expect(env.LORE_BACKEND_URL).toBe(cfg.backend);
    expect(env.LORE_OIDC_ISSUER).toBe(cfg.issuer);
    expect(env.LORE_MCP_CLIENT_ID).toBe(cfg.clientId);
    expect(env.LORE_MACHINE_ID).toBe('nb');
    expect(env.LORE_MCP_CLIENT_SECRET).toBe('${LORE_MCP_CLIENT_SECRET}');
  });
  it('команда claude mcp add — те же переменные, секрет не вписан', () => {
    const c = mcpAddCommand(cfg);
    expect(c).toContain('claude mcp add aida-lore');
    expect(c).toContain('LORE_MCP_CLIENT_ID=lore-mcp-full_nb');
    expect(c).toContain('LORE_MACHINE_ID=nb');
    expect(c).not.toContain(SECRET);
  });
});

describe('модель · проверка «заработало»', () => {
  const since = Date.parse('2026-11-11T10:00:00Z');
  it('сессия с этой машины после старта мастера — «видно»; раньше — ещё ждём', () => {
    const fresh = [{ session_id: 's1', machine_id: 'nb', last_activity_at: '2026-11-11T10:05:00Z' }];
    const old = [{ session_id: 's0', machine_id: 'nb', last_activity_at: '2026-11-11T09:00:00Z' }];
    expect(firstCallOf({ sessions: fresh, owners: [] }, { clientId: 'lore-mcp-full_nb', machine: 'nb', since }))
      .toEqual({ kind: 'seen', how: 'session', at: '2026-11-11T10:05:00Z' });
    expect(firstCallOf({ sessions: old, owners: [] }, { clientId: 'lore-mcp-full_nb', machine: 'nb', since }))
      .toEqual({ kind: 'waiting' });
  });
  it('запись агента с этой машины (USES_MACHINE / machine_id) — «видно»', () => {
    const owners = [{ actor_id: 'lore-mcp-full_nb', client_id: 'lore-mcp-full_nb', machine_id: 'nb', machines: ['nb'] }];
    expect(firstCallOf({ sessions: [], owners }, { clientId: 'lore-mcp-full_nb', machine: 'nb', since }))
      .toEqual({ kind: 'seen', how: 'write', at: null });
  });
});

// ── экраны ────────────────────────────────────────────────────────────────

interface Opts {
  users?: unknown[];
  agentClient?: { status: number; body: unknown };
  sessions?: unknown[];
}

function mockFetch(opts: Opts = {}) {
  let users = opts.users ?? KC_USERS;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/lore/kc/users')) return json(users);
    if (url === '/lore/kc/user' && method === 'POST') {
      const b = JSON.parse(String(init?.body)) as { username: string; email: string };
      users = [...users, { id: 'u-new', username: b.username, email: b.email, enabled: true, roles: [] }];
      return json({ ok: true, username: b.username, note: 'пароль задаётся в KC' });
    }
    if (url.startsWith('/lore/slice/role_matrix')) return json(MATRIX);
    if (url.startsWith('/lore/user/role/batch')) {
      return json({ kc_sub: 'u-anna', dry_run: true, plan: [
        { project: 'NooriUta/UnlimitedLORE', before: null, after: 'developer', kind: 'grant', sign: '+', check: { state: 'checked' } },
      ] });
    }
    if (url.startsWith('/lore/kc/agents')) return json(KC_AGENTS);
    if (url.startsWith('/lore/slice/agent_owners')) return json(OWNERS);
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [{ code: 'claude-code', label_ru: 'Claude Code', is_active: true, sort_order: 1 }] });
    if (url.startsWith('/lore/slice/agent_sessions')) return json({ rows: opts.sessions ?? [] });
    if (url === '/lore/kc/agent-client') {
      const a = opts.agentClient ?? { status: 200, body: { ok: true, clientId: 'lore-mcp-developer_nb', secret: SECRET, roles_copied: ['agent-developer'] } };
      return json(a.body, a.status);
    }
    if (url === '/lore/actor' || url === '/lore/actor/owner') return json({ ok: true, owner_linked: true });
    return json({ error: 'unexpected ' + url }, 500);
  });
}

const calls = (f: ReturnType<typeof mockFetch>, path: string) =>
  f.mock.calls.filter(([u]) => String(u) === path).map(([, i]) => JSON.parse(String((i as RequestInit).body)) as Record<string, unknown>);

function renderScreen(f: typeof fetch, wiz?: string) {
  if (wiz) window.history.replaceState(null, '', `/?adm-wiz=${wiz}`);
  return render(
    <KitLangProvider lang="ru">
      <WizardsScreen fetchImpl={f} meSub="u-me" env={{ backend: 'https://lore.example/_backend', issuer: 'https://kc.example/realms/omilore' }} />
    </KitLangProvider>,
  );
}

const next = () => fireEvent.click(screen.getByTestId('kit-steps-next'));

describe('экран · выбор мастера', () => {
  it('три мастера, выбор — в адресе', async () => {
    const f = mockFetch();
    renderScreen(f as unknown as typeof fetch);
    expect(screen.getByTestId('adm-wiz-pick-person')).toBeTruthy();
    expect(screen.getByTestId('adm-wiz-pick-agent')).toBeTruthy();
    expect(screen.getByTestId('adm-wiz-pick-machine')).toBeTruthy();
    fireEvent.click(screen.getByTestId('adm-wiz-pick-machine'));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('adm-wiz')).toBe('machine'));
  });
});

describe('экран · UC-1 подключить человека', () => {
  it('найдена учётка → проекты как у похожего → дифф пачкой только отмеченных', async () => {
    const f = mockFetch();
    renderScreen(f as unknown as typeof fetch, 'person');
    fireEvent.change(await screen.findByTestId('adm-wiz-login'), { target: { value: 'anna@seidr.test' } });
    expect((await screen.findByTestId('adm-wiz-found')).textContent).toContain('u-anna');
    next();
    fireEvent.change(await screen.findByTestId('adm-wiz-like'), { target: { value: 'u-volva' } });
    const box = await screen.findByTestId('adm-wiz-proj-NooriUta/volva');
    fireEvent.click(box);
    next();
    await waitFor(() => expect(calls(f, '/lore/user/role/batch').length).toBeGreaterThan(0));
    const req = calls(f, '/lore/user/role/batch')[0];
    expect(req.kc_sub).toBe('u-anna');
    expect(req.dry_run).toBe(true);
    expect(req.changes).toEqual([
      { project: 'AIDA/miniLORE', role: 'developer' },
      { project: 'NooriUta/UnlimitedLORE', role: 'developer' },
    ]);
  });

  it('не найдена → «Завести в Keycloak» заводит и находит; пароль — в «осталось руками»', async () => {
    const f = mockFetch();
    renderScreen(f as unknown as typeof fetch, 'person');
    fireEvent.change(await screen.findByTestId('adm-wiz-login'), { target: { value: 'boris@seidr.test' } });
    expect(await screen.findByTestId('adm-wiz-notfound')).toBeTruthy();
    expect(screen.getByTestId('kit-steps-next').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByTestId('adm-wiz-create'));
    await waitFor(() => expect(calls(f, '/lore/kc/user')).toEqual([{ username: 'boris', email: 'boris@seidr.test' }]));
    expect((await screen.findByTestId('adm-wiz-found')).textContent).toContain('u-new');
  });
});

describe('экран · UC-2 дать человеку агента', () => {
  it('чей + профиль + машина → учётка агента; секрет один раз; владелец и машина привязаны', async () => {
    const f = mockFetch();
    renderScreen(f as unknown as typeof fetch, 'agent');
    fireEvent.change(await screen.findByTestId('adm-wiz-owner'), { target: { value: 'u-volva' } });
    next();
    fireEvent.click(await screen.findByTestId('adm-wiz-profile-developer'));
    fireEvent.change(screen.getByTestId('adm-wiz-machine'), { target: { value: 'nb' } });
    next();
    fireEvent.click(await screen.findByTestId('adm-wiz-issue'));
    await waitFor(() => expect(calls(f, '/lore/kc/agent-client')).toEqual([{ profile: 'developer', machine: 'nb' }]));
    await waitFor(() => expect(calls(f, '/lore/actor/owner')).toHaveLength(1));
    expect(calls(f, '/lore/actor')[0]).toMatchObject({ actor_id: 'lore-mcp-developer_nb', kind: 'agent' });
    expect(calls(f, '/lore/actor/owner')[0]).toMatchObject({
      actor_id: 'lore-mcp-developer_nb', client_id: 'lore-mcp-developer_nb', kc_sub: 'u-volva', agent_role: 'developer', machine_id: 'nb',
    });
    // Секрет — только за предупреждением SecretOnce; в конфиге и в адресе его нет.
    expect((await screen.findByTestId('adm-wiz-mcpjson')).textContent).not.toContain(SECRET);
    expect(window.location.href).not.toContain(SECRET);
  });

  it('учётка уже есть (409) — слова сервера, секрет не выдуман, повторной выдачи нет', async () => {
    const f = mockFetch({ agentClient: { status: 409, body: { error: 'EXISTS', detail: 'lore-mcp-developer_nb уже есть — секрет повторно не выдаётся' } } });
    renderScreen(f as unknown as typeof fetch, 'agent');
    fireEvent.change(await screen.findByTestId('adm-wiz-owner'), { target: { value: 'u-volva' } });
    next();
    fireEvent.click(await screen.findByTestId('adm-wiz-profile-developer'));
    fireEvent.change(screen.getByTestId('adm-wiz-machine'), { target: { value: 'nb' } });
    next();
    fireEvent.click(await screen.findByTestId('adm-wiz-issue'));
    expect((await screen.findByTestId('adm-wiz-issue-error')).textContent).toContain('секрет повторно не выдаётся');
    expect(calls(f, '/lore/actor/owner')).toHaveLength(0);
  });
});

describe('экран · UC-7 новый ноутбук', () => {
  it('имя, занятое чужой машиной, — вперёд нельзя, и сказано чья', async () => {
    const f = mockFetch();
    renderScreen(f as unknown as typeof fetch, 'machine');
    fireEvent.change(await screen.findByTestId('adm-wiz-machine'), { target: { value: 'volvabox' } });
    expect(await screen.findByText(/volva/, { selector: '[data-testid="kit-steps-blocked"]' })).toBeTruthy();
    expect(screen.getByTestId('kit-steps-next').getAttribute('aria-disabled')).toBe('true');
  });

  it('агент машины — владелец вы; команда для вставки; проверка видит сессию с машины', async () => {
    const f = mockFetch({
      agentClient: { status: 200, body: { ok: true, clientId: 'lore-mcp-full_nb', secret: SECRET, roles_copied: [] } },
      sessions: [{ session_id: 's1', machine_id: 'nb', last_activity_at: new Date(Date.now() + 60_000).toISOString() }],
    });
    renderScreen(f as unknown as typeof fetch, 'machine');
    fireEvent.change(await screen.findByTestId('adm-wiz-machine'), { target: { value: 'nb' } });
    next();
    fireEvent.click(await screen.findByTestId('adm-wiz-issue'));
    await waitFor(() => expect(calls(f, '/lore/actor/owner')).toHaveLength(1));
    expect(calls(f, '/lore/actor/owner')[0]).toMatchObject({ kc_sub: 'u-me', machine_id: 'nb' });
    expect((await screen.findByTestId('adm-wiz-command')).textContent).toContain('LORE_MACHINE_ID=nb');
    next();
    fireEvent.click(await screen.findByTestId('adm-wiz-check'));
    expect(await screen.findByTestId('adm-wiz-seen')).toBeTruthy();
  });
});
