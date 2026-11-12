// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-21 — UC-3 «почему не видит / 403» для АГЕНТА и
// ИНСТРУМЕНТА MCP, кнопка «Исправить» прямо из цепочки и детектор 403 на Главной.
//
// Цепочка — та, по которой решает сервер (AL-68 / ADR-LORE-036-D4):
//   учётка (client_id) → агент в графе → владелец (OWNED_BY) → роль владельца
//   в проекте (читать) → делегирует ли роль профиль агента (писать).
// Шаги берутся из ответов сервера (/lore/admin/access/agents и
// /lore/admin/access?kc_sub=владелец), а не выдумываются клиентом. Чего сервер
// не объясняет (какое семейство пишет инструмент MCP), — помечено «не смогли
// проверить» с причиной «сервер не объяснил», а не «разрешено».
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { agentChain, since24h, type ToolExplain, type WhyInput } from './whyAccess';
import { WhyNotSee, WHY_AGENT, WHY_MODE, WHY_PROJECT, WHY_TOOL } from './WhyNotSee';
import { Home403Card } from './Home403Card';
import type { AgentProjects, AccessExplain } from './access';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const tr = (k: string, p?: Record<string, unknown>) => (p ? `${k}${JSON.stringify(p)}` : k);

const AGENT = { actor_id: 'A1', name: 'Claude', client_id: 'c1', agent_role: 'developer' };
const ok = <T,>(data: T) => ({ ok: true as const, data });
const ACC: AgentProjects = { client_id: 'c1', owner_kc_sub: 'u1', visible: ['P1', 'P2'], writable: ['P1'], inherited_from: 'u1', reason: null };
const explain = (role: string | null, profiles: string[] = []): AccessExplain => ({
  project: 'P2', realm_role: null, project_role: role, scope_enforced: true, sees: role !== null, can_write: role !== null && role !== 'reader',
  agent_profiles: profiles, chain: [],
});
const base = (o: Partial<WhyInput> = {}): WhyInput => ({ agent: AGENT, project: 'P1', tool: null, access: ok(ACC), owner: ok(explain('developer', ['developer', 'tester'])), ...o });

describe('S7B-21 · цепочка агента — как решает сервер', () => {
  it('пишет: все пять шагов подтверждены, решает делегирование, исправлять нечего', () => {
    const r = agentChain(base(), tr);
    expect(r.steps.map(s => s.id)).toEqual(['account', 'agent', 'owner', 'role', 'delegate']);
    expect(r.steps.every(s => s.outcome.state === 'confirmed')).toBe(true);
    expect(r.verdict).toBe('writes');
    expect(r.decidedBy).toBe('delegate');
    expect(r.fix).toBeNull();
  });

  it('нет владельца — решает шаг «владелец», дальше не считали (2), исправить = привязать владельца', () => {
    const r = agentChain(base({ access: ok({ ...ACC, owner_kc_sub: null, visible: [], writable: [], reason: 'нет OWNED_BY' }), owner: null }), tr);
    expect(r.verdict).toBe('none');
    expect(r.decidedBy).toBe('owner');
    expect(r.steps.find(s => s.id === 'owner')?.outcome).toMatchObject({ state: 'denied', detail: 'нет OWNED_BY' });
    expect(r.stopped?.notRun).toBe(2);
    expect(r.fix).toEqual({ kind: 'owner', actor_id: 'A1', client_id: 'c1', agent: 'Claude' });
  });

  it('у владельца нет роли в проекте — не видит; исправить = выдать роль владельцу', () => {
    const r = agentChain(base({ project: 'P3', owner: ok(explain(null)) }), tr);
    expect(r.verdict).toBe('none');
    expect(r.decidedBy).toBe('role');
    expect(r.fix).toEqual({ kind: 'role', owner_kc_sub: 'u1', project: 'P3', current: null, need: 'see' });
  });

  it('роль владельца не делегирует профиль — читает, не пишет; исправить = сменить роль', () => {
    const r = agentChain(base({ project: 'P2', owner: ok(explain('reader')) }), tr);
    expect(r.verdict).toBe('reads');
    expect(r.decidedBy).toBe('delegate');
    expect(r.steps.find(s => s.id === 'role')?.outcome.state).toBe('confirmed');
    expect(r.steps.find(s => s.id === 'delegate')?.outcome.state).toBe('denied');
    expect(r.fix).toEqual({ kind: 'role', owner_kc_sub: 'u1', project: 'P2', current: 'reader', need: 'delegate' });
  });

  it('профиль агента не задан — делегирование «не смогли проверить», а не «нельзя»', () => {
    const r = agentChain(base({ agent: { ...AGENT, agent_role: null } }), tr);
    expect(r.steps.find(s => s.id === 'delegate')?.outcome.state).toBe('unverified');
    expect(r.verdict).toBe('reads');
  });

  it('сервер не ответил — шаг владельца «не смогли», 403 — «смотреть не дали»; итог неизвестен', () => {
    const down = agentChain(base({ access: { ok: false, forbidden: false, reason: 'HTTP 502' }, owner: null }), tr);
    expect(down.verdict).toBe('unknown');
    expect(down.steps.find(s => s.id === 'owner')?.outcome).toMatchObject({ state: 'unverified', reason: 'HTTP 502' });
    expect(down.fix).toBeNull();
    const no = agentChain(base({ access: { ok: false, forbidden: true, reason: 'admin only' }, owner: null }), tr);
    expect(no.steps.find(s => s.id === 'owner')?.outcome.state).toBe('forbidden');
  });

  it('нет учётки (client_id) — в цепочку не войти, решает первый шаг', () => {
    const r = agentChain(base({ agent: { ...AGENT, client_id: null } }), tr);
    expect(r.decidedBy).toBe('account');
    expect(r.verdict).toBe('none');
    expect(r.stopped?.notRun).toBe(4);
  });

  // Инструмент объясняет СЕРВЕР: GET /lore/admin/access/tool — решение AgentScopeFilter.decide,
  // то же, что отказывает на проде (AgentToolExplain). Клиент матрицу не повторяет.
  const TOOL_DENIED: ToolExplain = { verdict: 'denied', profile: 'developer', path: '/lore/decision', family: 'decision',
    what: 'decision', why: 'профилю доступны: full, architect', allowed_profiles: ['architect', 'full'], human_only: false, fix: 'change_profile' };
  it('инструмент закрыт профилю — решает шаг «инструмент» словами сервера; исправить = сменить профиль на открытый', () => {
    const r = agentChain(base({ tool: 'decision', toolExplain: ok(TOOL_DENIED) }), tr);
    expect(r.steps[0].id).toBe('tool');
    expect(r.steps[0].outcome.state).toBe('denied');
    expect(JSON.stringify(r.steps[0].outcome)).toContain('профилю доступны: full, architect');
    expect(r.decidedBy).toBe('tool');
    expect(r.verdict).toBe('toolDenied');
    expect(r.fix).toEqual({ kind: 'profile', owner_kc_sub: 'u1', profiles: ['architect', 'full'], tool: 'decision', current: 'developer' });
  });
  it('инструмент человеческого семейства — исправить агентом нечем (fix=human), а не «сменить профиль»', () => {
    const r = agentChain(base({ tool: 'dict', toolExplain: ok({ ...TOOL_DENIED, what: 'dict', allowed_profiles: [], human_only: true, fix: 'human' }) }), tr);
    expect(r.verdict).toBe('toolDenied');
    expect(r.fix).toEqual({ kind: 'human', tool: 'dict' });
  });
  it('инструмент открыт профилю — шаг подтверждён, итог решает проектная ось (D4)', () => {
    const r = agentChain(base({ tool: 'task', toolExplain: ok({ ...TOOL_DENIED, verdict: 'allowed', what: undefined, why: null, fix: 'project_role' }) }), tr);
    expect(r.steps[0].outcome.state).toBe('confirmed');
    expect(r.verdict).toBe('writes');
  });
  it('сервер не объяснил инструмент — «не смогли проверить», итог по проекту не выдаётся за «разрешено»', () => {
    const r = agentChain(base({ tool: 'adr', toolExplain: { ok: false, forbidden: false, reason: 'HTTP 502' } }), tr);
    expect(r.steps[0].outcome.state).toBe('unverified');
    expect(r.verdict).toBe('toolUnknown');
  });

  it('since24h — ISO-момент ровно сутки назад (UTC, без долей)', () => {
    expect(since24h(Date.parse('2026-11-11T12:00:00.500Z'))).toBe('2026-11-10T12:00:00Z');
  });
});

// ── экран ────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const AGENTS = [
  { actor_id: 'A1', name: 'Claude', client_id: 'c1', agent_role: 'developer', owner_kc_sub: ['u1'], owner_display_name: ['Аня'] },
  { actor_id: 'A2', name: 'Kimi', client_id: 'c2', agent_role: 'pm', owner_kc_sub: [], owner_display_name: [] },
];
const MATRIX = { rows: [
  { kc_sub: 'u1', display_name: 'Аня', state: 'checked', cells: [{ project: 'P1', role: 'developer', state: 'checked', source: 'graph' }] },
  { kc_sub: 'u2', display_name: 'Боря', state: 'checked', cells: [] },
], sources_asked: ['graph'] };

interface Call { url: string; body?: Record<string, unknown> }
function fake(o: { failures?: unknown; failStatus?: number } = {}) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, body });
    if (url.startsWith('/lore/slice/agent_owners')) return json({ rows: AGENTS });
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [] });
    if (url.startsWith('/lore/slice/role_matrix')) return json(MATRIX);
    if (url.startsWith('/lore/slice/mcp_failure_rows')) return json({ rows: [
      { ts: 5, family: 'adr', entity_id: 'ADR-1', caller: 'developer', status: 403 },
      { ts: 6, family: 'decision', entity_id: 'lore/decision', caller: 'developer', status: 403 },
    ] });
    if (url.startsWith('/lore/admin/access/tool?')) {
      const q = new URLSearchParams(url.split('?')[1]);
      const fam = q.get('family') ?? '';
      return fam === 'decision' || (q.get('path') ?? '').includes('decision')
        ? json({ verdict: 'denied', profile: q.get('agent_scope'), path: '/lore/decision', family: 'decision', what: 'decision', why: 'профилю доступны: full, architect', allowed_profiles: ['architect', 'full'], human_only: false, fix: 'change_profile' })
        : json({ verdict: 'allowed', profile: q.get('agent_scope'), path: '/lore/' + fam, family: fam, why: null, allowed_profiles: ['full'], human_only: false, fix: 'project_role' });
    }
    if (url.startsWith('/lore/slice/mcp_failures')) {
      return o.failStatus ? json({ error: 'DOWN', detail: 'metrics down' }, o.failStatus)
        : json(o.failures ?? { rows: [{ caller: 'developer', failures: 3, last_failure: 1 }, { caller: 'pm', failures: 1, last_failure: 2 }] });
    }
    if (url.startsWith('/lore/admin/access/agents?client_id=c1')) return json({ ...ACC, agent_scope: 'developer' });
    if (url.startsWith('/lore/admin/access/agents?client_id=c2')) {
      return json({ client_id: 'c2', owner_kc_sub: null, visible: [], writable: [], inherited_from: null, reason: 'у клиента нет владельца' });
    }
    if (url.startsWith('/lore/admin/access?')) {
      const p = new URLSearchParams(url.split('?')[1]).get('project');
      return json(p === 'P2' ? explain('reader') : { ...explain(null), project: p });
    }
    if (url === '/lore/actor/owner') return json({ ok: true, actor_id: 'A2', client_id: 'c2', owner_linked: true });
    if (url === '/lore/user/role/batch') {
      return json({ plan: [{ project: 'P3', before: null, after: 'developer', kind: 'grant', check: { state: 'checked', source: 'graph' } }], undo: [] });
    }
    return json({ rows: [] });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const at = (p: Record<string, string>) => window.history.replaceState(null, '', `/?${new URLSearchParams(p).toString()}`);
const mountWhy = (f: typeof fetch) => render(<KitLangProvider lang="ru"><WhyNotSee projects={['P1', 'P2', 'P3']} fetchImpl={f} /></KitLangProvider>);

describe('S7B-21 · «почему не видит» агент / инструмент — экран', () => {
  it('агент без владельца: цепочка kit ChainExplain, решает «владелец», «Исправить» → дифф → привязка POST /lore/actor/owner', async () => {
    at({ [WHY_MODE]: 'agent', [WHY_AGENT]: 'A2', [WHY_PROJECT]: 'P1' });
    const { f, calls } = fake();
    mountWhy(f);
    expect(await screen.findByTestId('kit-chain-decider-owner')).toBeTruthy();
    expect(screen.getByTestId('kit-chain-step-owner').getAttribute('data-state')).toBe('denied');
    fireEvent.click(screen.getByTestId('adm-why-fix'));
    const box = await screen.findByTestId('adm-why-ownerfix');
    fireEvent.change(within(box).getByTestId('adm-why-owner-pick'), { target: { value: 'u2' } });
    // Без слова-подтверждения кнопка применения занята — запись не уходит.
    expect(calls.some(c => c.url === '/lore/actor/owner')).toBe(false);
    const word = within(box).getByRole('textbox');
    fireEvent.change(word, { target: { value: 'Kimi' } });
    fireEvent.click(within(box).getByRole('button', { name: /примен/i }));
    await waitFor(() => expect(calls.some(c => c.url === '/lore/actor/owner')).toBe(true));
    expect(calls.find(c => c.url === '/lore/actor/owner')?.body).toMatchObject({ actor_id: 'A2', client_id: 'c2', kc_sub: 'u2' });
    // Отката у сервера нет — сказано словами, а не спрятано.
    expect(await within(box).findByTestId('adm-why-owner-noundo')).toBeTruthy();
  });

  it('у владельца нет роли в проекте: «Исправить» открывает DangerBatch с dry_run на владельца', async () => {
    at({ [WHY_MODE]: 'agent', [WHY_AGENT]: 'A1', [WHY_PROJECT]: 'P3' });
    const { f, calls } = fake();
    mountWhy(f);
    expect(await screen.findByTestId('kit-chain-decider-role')).toBeTruthy();
    fireEvent.click(screen.getByTestId('adm-why-fix'));
    fireEvent.change(await screen.findByTestId('adm-why-role-pick'), { target: { value: 'developer' } });
    fireEvent.click(screen.getByTestId('adm-why-role-go'));
    await screen.findByTestId('adm-danger');
    await waitFor(() => expect(calls.some(c => c.url === '/lore/user/role/batch' && c.body?.dry_run === true)).toBe(true));
    expect(calls.find(c => c.url === '/lore/user/role/batch')?.body).toMatchObject({ kc_sub: 'u1', changes: [{ project: 'P3', role: 'developer' }] });
  });

  it('инструмент: шаг «инструмент» — ответ сервера (/lore/admin/access/tool по профилю агента); ниже — отказы 403 за сутки', async () => {
    at({ [WHY_MODE]: 'tool', [WHY_AGENT]: 'A1', [WHY_PROJECT]: 'P1', [WHY_TOOL]: 'decision' });
    const { f, calls } = fake();
    mountWhy(f);
    const step = await screen.findByTestId('kit-chain-step-tool');
    await waitFor(() => expect(step.getAttribute('data-state')).toBe('denied'));
    expect(step.textContent).toContain('профилю доступны: full, architect');
    const toolCall = calls.find(c => c.url.startsWith('/lore/admin/access/tool?'))!.url;
    expect(toolCall).toContain('agent_scope=developer');
    expect(toolCall).toContain('family=decision');
    // «Исправить» → сменить профиль: мастер «агент человеку» с владельцем и открытым профилем.
    fireEvent.click(screen.getByTestId('adm-why-fix'));
    fireEvent.click(await screen.findByTestId('adm-why-profile-architect'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('adm')).toBe('wiz');
    expect(q.get('adm-wiz')).toBe('agent');
    expect(q.get('adm-owner')).toBe('u1');
    expect(q.get('adm-profile')).toBe('architect');
  });

  it('отказ 403 за сутки — у каждой строки свой разбор сервера (профиль из журнала × путь)', async () => {
    at({ [WHY_MODE]: 'tool' });
    const { f, calls } = fake();
    mountWhy(f);
    fireEvent.click(await screen.findByTestId('adm-why-403-explain-1'));
    const v = await screen.findByTestId('adm-why-403-verdict-1');
    expect(v.getAttribute('data-verdict')).toBe('denied');
    expect(v.textContent).toContain('профилю доступны: full, architect');
    const u = calls.find(c => c.url.startsWith('/lore/admin/access/tool?'))!.url;
    expect(u).toContain('agent_scope=developer');
    expect(u).toContain('path=' + encodeURIComponent('lore/decision'));
  });

  it('строка отказа подставляет инструмент в вопрос', async () => {
    at({ [WHY_MODE]: 'tool', [WHY_AGENT]: 'A1', [WHY_PROJECT]: 'P1', [WHY_TOOL]: 'x' });
    const { f, calls } = fake();
    mountWhy(f);
    expect(await screen.findByTestId('adm-why-403-row-0')).toBeTruthy();
    const rowsCall = calls.find(c => c.url.startsWith('/lore/slice/mcp_failure_rows'))!;
    expect(rowsCall.url).toContain('code=403');
    expect(rowsCall.url).toContain('since=');
    // Строка отказа подставляет семейство в поле инструмента.
    fireEvent.click(screen.getByTestId('adm-why-403-row-0'));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get(WHY_TOOL)).toBe('adr'));
  });
});

describe('S7B-21 · детектор 403 на Главной', () => {
  it('сумма отказов 403 за сутки — срез mcp_failures с since и code=403; кнопка ведёт в «почему не видит»', async () => {
    const { f, calls } = fake();
    render(<KitLangProvider lang="ru"><Home403Card fetchImpl={f} now={() => Date.parse('2026-11-11T12:00:00Z')} /></KitLangProvider>);
    const card = await screen.findByTestId('adm-home-403');
    await waitFor(() => expect(card.getAttribute('data-n')).toBe('4'));
    const u = calls.find(c => c.url.startsWith('/lore/slice/mcp_failures'))!.url;
    expect(u).toContain('code=403');
    expect(u).toContain(`since=${encodeURIComponent('2026-11-10T12:00:00Z')}`);
    fireEvent.click(within(card).getByTestId('adm-home-403-fix'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('adm')).toBe('who');
    expect(q.get(WHY_MODE)).toBe('tool');
  });

  it('срез не прочитан — «не смогли проверить», а не «0 отказов»', async () => {
    const { f } = fake({ failStatus: 502 });
    render(<KitLangProvider lang="ru"><Home403Card fetchImpl={f} /></KitLangProvider>);
    const card = await screen.findByTestId('adm-home-403');
    await waitFor(() => expect(card.getAttribute('data-state')).toBe('error'));
    expect(card.getAttribute('data-n')).toBeNull();
  });
});

describe('S7B-21 · точки подключения', () => {
  it('Главная показывает детектор 403 среди карточек «требует внимания»', async () => {
    const { AdminHome } = await import('./HomeScreen');
    const { f } = fake();
    render(<KitLangProvider lang="ru"><AdminHome fetchImpl={f} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-home-403')).toBeTruthy();
  });

  it('экран «Кто где» несёт блок «почему не видит» агента / инструмента', async () => {
    const { WhoWhereScreen } = await import('./WhoWhereScreen');
    const { f } = fake();
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={f} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-why')).toBeTruthy();
  });

  it('«Агенты»: у раскрытого агента — переход «почему не видит» с этим агентом в вопросе', async () => {
    const { AgentsScreen } = await import('./AgentsScreen');
    const { f } = fake();
    render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={f} /></KitLangProvider>);
    fireEvent.click(await screen.findByTestId('adm-agent-proj-btn-A1'));
    fireEvent.click(await screen.findByTestId('adm-agent-why-A1'));
    const q = new URLSearchParams(window.location.search);
    expect(q.get('adm')).toBe('who');
    expect(q.get(WHY_AGENT)).toBe('A1');
  });
});
