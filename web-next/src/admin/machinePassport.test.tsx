// @vitest-environment jsdom
// SPRINT_LORE_ADMIN_POLISH/AP-MACHINE-PASSPORT — паспорт машины и мастер «Новая машина» в админке.
// Прототип docs/prototypes/ap-machine-passport.html (ветка feat/ap-machine-passport-proto), «да» владельца 25.11.
// Решения из заметки задачи: 1 — только админка, свой адрес; 2б — агенты по ребру + «были сессией»;
// 3б — группа «Без шлюза» с кнопкой «Завести шлюз»; 4а — мастер учётку KC не заводит, «осталось руками»;
// 5в — «Новая машина» и в списке машин, и в «Мастерах», мастер один; 6б — обе даты с подписью источника.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import {
  agentPlan, edgeAgents, machineIdProblem, machinePassportHref, parseEnroll, parseGraphMachines, planRows,
  sessionOnly, withoutGateway, parseSessions,
} from './machineGraph';
import { MachinesScreen } from './MachinesScreen';
import { NewMachineWizard } from './NewMachineWizard';
import { WizardsScreen } from './WizardsScreen';
import { AdminNavProvider } from './adminNav';
import { recordHref } from '../nav/loreRoutes';
import { PASSPORT_TYPES } from '../record/passportAdapters';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const ACL = [{
  actor_id: 'minilore-link-lorcetus', client_id: 'minilore-link-lorcetus', machine_id: 'lorcetus', name: 'lorcetus',
  owner_kc_sub: ['u-ann'], owner_display_name: ['Ann So'],
  grant_kc_subs: [], grant_display_names: [], grant_roles: [], grant_projects: [], grant_harnesses: [], grant_granted_by: [], grant_granted_at: [],
  can_write: true,
}];
const GRAPH = [
  {
    machine_id: 'lorcetus', first_seen_at: '2026-11-11T08:00:00Z', last_seen_at: '2026-11-22T15:46:00Z',
    gateway: 'minilore-link-lorcetus', gateway_name: 'lorcetus', harness: 'kimi', owner: 'u-ann', owner_name: 'Ann So',
    agent_ids: ['AGENT-FULL', 'minilore-link-lorcetus'], agent_clients: ['lore-mcp-full', 'minilore-link-lorcetus'],
  },
  {
    machine_id: 'argharaga', first_seen_at: '2026-11-20T08:00:00Z', last_seen_at: '2026-11-23T07:44:00Z',
    gateway: null, gateway_name: null, harness: null, owner: null, owner_name: null,
    agent_ids: ['AGENT-FULL_ARHARAGA'], agent_clients: ['lore-mcp-full_arharaga'],
  },
];
const SESSIONS = [
  { session_id: 's-full', machine_id: 'lorcetus', dialogue_name: null, last_activity_at: '2026-11-22T21:22:00Z', actor_ids: ['AGENT-FULL'] },
  { session_id: 's-dev', machine_id: 'lorcetus', dialogue_name: 'link-release', last_activity_at: '2026-11-20T09:14:00Z', actor_ids: ['AGENT-DEVELOPER'] },
  { session_id: 's-none', machine_id: 'lorcetus', dialogue_name: null, last_activity_at: '2026-11-21T15:15:00Z', actor_ids: [] },
];
const ACTIONS = [
  { ts: '2026-11-22T22:04:00Z', family: 'forgejo', entity_id: '/lore/forgejo/pr', caller: 'lore-mcp-full', client: 'lore-mcp-full', machine: 'lorcetus', status: 200 },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Opts = { graphStatus?: number; actionsStatus?: number; enroll?: (b: Record<string, unknown>) => Response };
function fake(opts: Opts = {}) {
  const posts: Array<Record<string, unknown>> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/lore/slice/machine_acl')) return json({ rows: ACL });
    if (url.startsWith('/lore/slice/machines_graph')) return opts.graphStatus ? json({ error: 'UPSTREAM', detail: 'база не ответила' }, opts.graphStatus) : json({ rows: GRAPH });
    if (url.startsWith('/lore/slice/machine_by_id')) {
      const id = new URLSearchParams(url.split('?')[1]).get('id');
      return json({ rows: GRAPH.filter(g => g.machine_id === id) });
    }
    if (url.startsWith('/lore/slice/agent_sessions')) return json({ rows: SESSIONS });
    if (url.startsWith('/lore/slice/agent_actions')) return opts.actionsStatus ? json({ error: 'FORBIDDEN', detail: 'журнал — только admin' }, opts.actionsStatus) : json({ rows: ACTIONS });
    if (url.startsWith('/lore/slice/role_matrix')) return json({ rows: [{ kc_sub: 'u-ann', display_name: 'Ann So', projects: [], roles: [] }, { kc_sub: 'u-ar', display_name: 'arharaga', projects: [], roles: [] }] });
    if (url.startsWith('/lore/slice/agent_owners')) return json({ rows: [] });
    if (url.startsWith('/lore/actor/machine')) {
      const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
      posts.push(b);
      if (opts.enroll) return opts.enroll(b);
      return json({
        machine_id: b.machine_id, ok: true, client_id: `minilore-link-${b.machine_id}`, kc_sub: 'u-ar',
        plan: { kind: 'create', before: null, after: { actor_id: `minilore-link-${b.machine_id}`, client_id: `minilore-link-${b.machine_id}`, machine_id: b.machine_id, owner_kc_sub: 'u-ar', harness: b.harness ?? null, name: `minilore-link-${b.machine_id}` } },
        agents_to_link: [], agents_linked: [],
        ...(b.dry_run ? { dry_run: true, applied: 0 } : { outcome: 'CREATED', owner_linked: true }),
      });
    }
    return json({ rows: [] });
  }) as unknown as typeof fetch;
  return { f, posts };
}
const wrap = (ui: React.ReactNode) => render(<KitLangProvider lang="ru">{ui}</KitLangProvider>);
const stubRecord = (id: string) => <div data-testid="stub-record">{`machine:${id}`}</div>;

describe('AP-MACHINE-PASSPORT · данные', () => {
  it('машина — тип паспорта; ссылка ведёт в админку своим адресом (решение 1)', () => {
    expect(PASSPORT_TYPES as readonly string[]).toContain('machine');
    expect(machinePassportHref('lorcetus')).toBe('/?mod=admin&sec=adm-machines&adm-macl-open=lorcetus');
    // Общие поверхности в админку не ведут (правило владелицы 21.11, nav/noAdminLinks.test.ts): вне админки — null.
    expect(recordHref('machine', 'lorcetus')).toBeNull();
  });

  it('без шлюза — машины графа, у которых нет актора minilore-link-* (решение 3б)', () => {
    const g = parseGraphMachines(GRAPH);
    expect(withoutGateway(g, [{ machine_id: 'lorcetus' }]).map(m => m.machine_id)).toEqual(['argharaga']);
    expect(edgeAgents(g[0])).toEqual(['AGENT-FULL']);
  });

  it('«были сессией»: агенты сессий без ребра, сессия без агента — отдельной строкой (решение 2б)', () => {
    const only = sessionOnly(parseSessions(SESSIONS), ['AGENT-FULL']);
    expect(only.map(s => s.actor_id)).toEqual(['AGENT-DEVELOPER', null]);
  });

  it('план «было → станет» и агенты: «уже привязан» отдельно от «будет привязан» (находка 3)', () => {
    const a = parseEnroll({
      machine_id: 'arharaga', client_id: 'minilore-link-arharaga',
      plan: { kind: 'update', before: { actor_id: 'minilore-link-arharaga', owner_kc_sub: 'u-ar', harness: 'claude-code', name: 'n' }, after: { actor_id: 'minilore-link-arharaga', client_id: 'minilore-link-arharaga', machine_id: 'arharaga', owner_kc_sub: 'u-ar', harness: 'claude', name: 'n' } },
      agents_to_link: ['AGENT-NEW'], agents_linked: ['AGENT-FULL_ARHARAGA'],
    });
    const rows = planRows(a);
    expect(rows.find(r => r.key === 'harness')).toMatchObject({ before: 'claude-code', after: 'claude', same: false });
    expect(rows.find(r => r.key === 'owner')).toMatchObject({ same: true });
    expect(agentPlan(a)).toEqual([{ actor_id: 'AGENT-NEW', state: 'link' }, { actor_id: 'AGENT-FULL_ARHARAGA', state: 'linked' }]);
    // Старый сервер (без agents_linked) кладёт привязанного в agents_to_link — экран сверяет с ребром сам.
    const old = parseEnroll({ machine_id: 'x', client_id: 'minilore-link-x', plan: { kind: 'create', after: {} }, agents_to_link: ['A'] });
    expect(old.agents_linked).toBeNull();
    expect(agentPlan(old, ['A'])).toEqual([{ actor_id: 'A', state: 'linked' }]);
  });

  it('имя машины: пусто, префикс учётки, недопустимые знаки — словами, до запроса', () => {
    expect(machineIdProblem('')).toBe('empty');
    expect(machineIdProblem('minilore-link-lorcetus')).toBe('prefix');
    expect(machineIdProblem('мой ноут')).toBe('chars');
    expect(machineIdProblem('argharaga')).toBeNull();
  });
});

describe('AP-MACHINE-PASSPORT · список машин', () => {
  it('кнопка «Новая машина» открывает тот же мастер, что в «Мастерах» (решение 5в)', async () => {
    const { f } = fake();
    const go = vi.fn();
    wrap(<AdminNavProvider value={{ go }}><MachinesScreen fetchImpl={f} meSub="u-ann" /></AdminNavProvider>);
    fireEvent.click(await screen.findByTestId('adm-macl-new'));
    expect(go).toHaveBeenCalledWith('wiz', { 'adm-wiz': 'newmachine' });
  });

  it('группа «Без шлюза»: машина видна по агентам, кнопка «Завести шлюз» несёт её имя в мастер (решение 3б)', async () => {
    const { f } = fake();
    const go = vi.fn();
    wrap(<AdminNavProvider value={{ go }}><MachinesScreen fetchImpl={f} meSub="u-ann" /></AdminNavProvider>);
    const block = await screen.findByTestId('adm-macl-nogw');
    expect(block.textContent).toContain('argharaga');
    expect(block.textContent).not.toContain('lorcetus');
    fireEvent.click(within(block).getByTestId('adm-macl-nogw-enroll-argharaga'));
    expect(go).toHaveBeenCalledWith('wiz', { 'adm-wiz': 'newmachine', 'adm-nm-id': 'argharaga' });
  });

  it('машины графа не прочитались — «не смогли проверить», а не «без шлюза нет»', async () => {
    const { f } = fake({ graphStatus: 502 });
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ann" />);
    const err = await screen.findByTestId('adm-macl-nogw-error');
    expect(err.textContent).toContain('база не ответила');
    expect(screen.queryByTestId('adm-macl-nogw')).toBeNull();
  });

  it('строка списка открывает паспорт машины, выбор — в адресе', async () => {
    const { f } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ann" machineRecord={stubRecord} />);
    fireEvent.click(await screen.findByRole('button', { name: 'lorcetus' }));
    expect(new URLSearchParams(window.location.search).get('adm-macl-open')).toBe('lorcetus');
    expect(await screen.findByTestId('adm-mpass-lorcetus')).toBeTruthy();
  });
});

describe('AP-MACHINE-PASSPORT · паспорт', () => {
  it('запись из модели + обе даты с подписью источника + «были сессией» + журнал (6б, 2б)', async () => {
    window.history.replaceState(null, '', '/?adm-macl-open=lorcetus');
    const { f } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ann" machineRecord={stubRecord} />);
    const page = await screen.findByTestId('adm-mpass-lorcetus');
    expect((await within(page).findByTestId('stub-record')).textContent).toBe('machine:lorcetus');
    const act = await within(page).findByTestId('adm-mpass-activity');
    await waitFor(() => expect(act.textContent).toContain('22.11.2026 22:04'));
    expect(act.textContent).toContain('KnowMachine.last_seen_at');
    expect(act.textContent).toContain('agent_actions');
    const only = await within(page).findByTestId('adm-mpass-sessiononly');
    expect(only.textContent).toContain('AGENT-DEVELOPER');
    expect(only.textContent).toContain('link-release');
    expect(only.textContent).not.toContain('AGENT-FULL ');
    expect(within(page).getByTestId('adm-mpass-agents').textContent).toContain('1');
  });

  it('журнал только для admin: 403 — «не смогли проверить», а не «действий нет»', async () => {
    window.history.replaceState(null, '', '/?adm-macl-open=lorcetus');
    const { f } = fake({ actionsStatus: 403 });
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ann" machineRecord={stubRecord} />);
    const forb = await screen.findByTestId('adm-mpass-actions-forbidden');
    expect(forb.textContent).toContain('журнал — только admin');
    expect(screen.queryByTestId('adm-mpass-actions-empty')).toBeNull();
  });

  it('«Доступы» ведут на прежний экран допусков (Drawer) и матрицу — правка там, не дублируется', async () => {
    window.history.replaceState(null, '', '/?adm-macl-open=lorcetus');
    const { f } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ann" machineRecord={stubRecord} />);
    fireEvent.click(await screen.findByTestId('adm-mpass-grants'));
    expect(new URLSearchParams(window.location.search).get('adm-macl-m')).toBe('lorcetus');
    expect(await screen.findByTestId('adm-macl-passport-lorcetus')).toBeTruthy();
  });

  it('машины нет в графе — «не найдена», а не пустой паспорт', async () => {
    window.history.replaceState(null, '', '/?adm-macl-open=nosuch');
    const { f } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ann" machineRecord={stubRecord} />);
    expect(await screen.findByTestId('adm-mpass-notfound')).toBeTruthy();
  });
});

describe('AP-MACHINE-PASSPORT · мастер «Новая машина»', () => {
  it('в «Мастерах» есть «Новая машина» — отдельно от UC-7 «Новый ноутбук»', async () => {
    const { f } = fake();
    wrap(<WizardsScreen fetchImpl={f} meSub="u-ar" env={{ backend: 'https://lore', issuer: 'https://kc' }} />);
    expect(screen.getByTestId('adm-wiz-pick-newmachine')).toBeTruthy();
    expect(screen.getByTestId('adm-wiz-pick-machine')).toBeTruthy();
  });

  it('dry-run: план «было → станет», ничего не записано; «Завести» пишет и показывает «осталось руками» (4а)', async () => {
    window.history.replaceState(null, '', '/?adm-nm-id=argharaga');
    const { f, posts } = fake();
    const done = vi.fn();
    wrap(<NewMachineWizard fetchImpl={f} meSub="u-ar" onDone={done} />);
    fireEvent.click(await screen.findByTestId('adm-nm-check'));
    const plan = await screen.findByTestId('adm-nm-plan');
    expect(posts[0]).toMatchObject({ machine_id: 'argharaga', dry_run: true });
    expect(plan.textContent).toContain('minilore-link-argharaga');
    expect(plan.textContent).toContain('ничего не записано');
    fireEvent.click(screen.getByTestId('adm-nm-apply'));
    const ok = await screen.findByTestId('adm-nm-done');
    expect(posts[1]).toMatchObject({ machine_id: 'argharaga' });
    expect(posts[1].dry_run).toBeUndefined();
    expect(ok.textContent).toContain('minilore-link-argharaga');
    expect(screen.getByTestId('adm-nm-manual').textContent).toContain('Keycloak');
    expect(screen.getByTestId('adm-nm-manual').textContent).toContain('LORE_MACHINE_ID=argharaga');
  });

  it('отказ MACHINE_TAKEN — словами с владельцем, а не кодом; записи нет', async () => {
    window.history.replaceState(null, '', '/?adm-nm-id=lorcetus');
    const { f, posts } = fake({
      enroll: () => json({ error: 'MACHINE_TAKEN', detail: 'машина lorcetus уже заведена, её владелец — Ann So. Перепривязать владельца — machine_owner_set (только человек)' }, 409),
    });
    wrap(<NewMachineWizard fetchImpl={f} meSub="u-ar" onDone={() => {}} />);
    fireEvent.click(await screen.findByTestId('adm-nm-check'));
    const taken = await screen.findByTestId('adm-nm-taken');
    expect(taken.textContent).toContain('lorcetus уже занята');
    expect(taken.textContent).toContain('Ann So');
    expect(screen.queryByTestId('adm-nm-apply')).toBeNull();
    expect(posts).toHaveLength(1);
  });

  it('имя с префиксом учётки — подсказка до запроса, проверка закрыта', async () => {
    window.history.replaceState(null, '', '/?adm-nm-id=minilore-link-lorcetus');
    const { f, posts } = fake();
    wrap(<NewMachineWizard fetchImpl={f} meSub="u-ar" onDone={() => {}} />);
    expect((await screen.findByTestId('adm-nm-id-problem')).textContent).toContain('lorcetus');
    expect((screen.getByTestId('adm-nm-check') as HTMLButtonElement).disabled).toBe(true);
    expect(posts).toHaveLength(0);
  });
});
