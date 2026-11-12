// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-20 — UC-4 «Отключить человека» (прототип
// docs/prototypes/s7b-admin-v6.html, раздел UC-4).
//
// Сценарий: из карточки человека в «Кто где» — «Отключить…». Сначала видно
// всё, что за человеком числится (учётка KC, роли в проектах, агенты), потом
// снимается по блокам, каждый — с диффом и подтверждением логином:
//   • роли — одной пачкой через DangerBatch (POST /lore/user/role/batch, dry_run → дифф → применить → отменить);
//   • агенты — отключение учётки KC (POST /lore/kc/agent-client/{clientId}/disable);
//   • realm-роли — существующий путь KcDanger (POST /lore/kc/user/{id}/role).
// «Последний админ»: последний owner проекта (AL-100) и последний носитель
// realm-роли admin (AL-35) — кнопка заблокирована с объяснением словами
// сервера, а не подтверждением. «Не смогли проверить» ≠ «пусто».
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { PersonOffboard } from './PersonOffboard';
import { WhoWhereScreen } from './WhoWhereScreen';
import {
  agentDiffRows, findKcAccount, isLastRealmAdmin, offMachineItems, offRoleItems, parseKcClients, realmItems, revokeMachineRequests,
} from './offboard';
import { parseRoleMatrix } from './roles';
import { parseAgents } from './agents';
import { parseMachineAcl } from './machines';
import { parseKcUsers, type KcUser } from './wizards';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const MATRIX = [
  { kc_sub: 'u-anna', display_name: 'anna', projects: ['AIDA/miniLORE', 'NooriUta/UnlimitedLORE'], roles: ['editor', 'owner'] },
  { kc_sub: 'u-boss', display_name: 'boss', projects: ['NooriUta/UnlimitedLORE', 'AIDA/volva'], roles: ['owner', 'owner'] },
  { kc_sub: 'u-solo', display_name: 'solo', projects: ['AIDA/solo'], roles: ['owner'] },
];
const AGENTS = [
  { actor_id: 'AG-1', name: 'anna-claude', client_id: 'lore-mcp-full_anna', agent_role: 'full', harness: null, owner_kc_sub: ['u-anna'], owner_display_name: ['anna'] },
  { actor_id: 'AG-2', name: 'anna-old', client_id: 'lore-mcp-full_old', agent_role: 'full', harness: null, owner_kc_sub: ['u-anna'], owner_display_name: ['anna'] },
  { actor_id: 'AG-3', name: 'anna-nokc', client_id: null, agent_role: 'full', harness: null, owner_kc_sub: ['u-anna'], owner_display_name: ['anna'] },
  { actor_id: 'AG-9', name: 'boss-bot', client_id: 'lore-mcp-full_boss', agent_role: 'full', harness: null, owner_kc_sub: ['u-boss'], owner_display_name: ['boss'] },
];
const KC_USERS: KcUser[] = [
  { id: 'u-anna', username: 'anna', email: null, enabled: true, roles: ['viewer', 'default-roles-lore'] },
  { id: 'u-boss', username: 'boss', email: null, enabled: true, roles: ['admin'] },
  { id: 'u-solo', username: 'solo', email: null, enabled: true, roles: ['admin'] },
  { id: 'u-gone', username: 'gone', email: null, enabled: false, roles: ['admin'] },
];
const KC_CLIENTS = [
  { clientId: 'lore-mcp-full_anna', id: 'c1', enabled: true },
  { clientId: 'lore-mcp-full_old', id: 'c2', enabled: false },
];
const REALM_ROLES = [{ name: 'admin', grantable: true }, { name: 'viewer', grantable: true }, { name: 'super-admin', grantable: false }];
// Допуски к машинам (S7B-ACL-1): anna владеет «anna-pc» и допущена к «boss-pc».
const MACHINE_ACL = [
  {
    actor_id: 'M-1', client_id: 'minilore-link-anna-pc', machine_id: 'anna-pc', name: 'anna-pc',
    owner_kc_sub: ['u-anna'], owner_display_name: ['anna'],
    grant_kc_subs: [], grant_display_names: [], grant_roles: [], grant_projects: [], grant_harnesses: [], grant_granted_by: [], grant_granted_at: [],
  },
  {
    actor_id: 'M-2', client_id: 'minilore-link-boss-pc', machine_id: 'boss-pc', name: 'boss-pc',
    owner_kc_sub: ['u-boss'], owner_display_name: ['boss'],
    grant_kc_subs: ['u-anna'], grant_display_names: ['anna'], grant_roles: ['actor'],
    grant_projects: [['AIDA/miniLORE']], grant_harnesses: [[]], grant_granted_by: ['u-boss'], grant_granted_at: ['2026-11-10'],
  },
];

const roles = () => parseRoleMatrix({ rows: MATRIX });
const agents = () => parseAgents({ rows: AGENTS } as never).rows;
const WORDS = { noClient: 'нет учётки', absent: 'нет в KC', failed: (r: string) => `не смогли: ${r}` };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface FakeOpts {
  kcUsersStatus?: number; kcUsers?: unknown; agentsStatus?: number; users?: KcUser[]; aclStatus?: number;
  /** S7B-20: сервер отвечает на выключение учётки «нельзя» с этой причиной. */
  enabledForbidden?: string;
}

function fake(opts: FakeOpts = {}) {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    if (url.startsWith('/lore/slice/role_matrix')) return json({ rows: MATRIX });
    if (url.startsWith('/lore/slice/agent_owners')) return opts.agentsStatus ? json({ error: 'DOWN' }, opts.agentsStatus) : json({ rows: AGENTS });
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [] });
    if (url.startsWith('/lore/slice/machine_acl')) {
      if (opts.aclStatus) return json({ error: 'FORBIDDEN', detail: 'нет прав на срез' }, opts.aclStatus);
      const sub = new URL(url, 'http://x').searchParams.get('kc_sub');
      return json({ rows: sub ? MACHINE_ACL.filter(m => m.owner_kc_sub.includes(sub) || m.grant_kc_subs.includes(sub)) : MACHINE_ACL });
    }
    if (url === '/lore/user/machine-access' && body) {
      return json({ ok: true, dry_run: body.dry_run === true,
        plan: { kind: 'revoke', before: { role: 'actor', projects: ['AIDA/miniLORE'], harnesses: [] }, after: null } });
    }
    if (url === '/lore/kc/users') {
      return opts.kcUsersStatus ? json({ error: 'KC_NOT_CONFIGURED', detail: 'мост KC не настроен' }, opts.kcUsersStatus) : json(opts.users ?? KC_USERS);
    }
    if (url === '/lore/kc/realm-roles') return json(REALM_ROLES);
    if (url === '/lore/kc/agents') return json(KC_CLIENTS);
    if (url === '/lore/user/role/batch' && body) {
      const changes = (body.changes as Array<{ project: string }>) ?? [];
      // S7B-20: сервер сам отвечает отказом AL-100 строкой плана (последний owner).
      if (body.kc_sub === 'u-solo') {
        return json({
          ok: true, kc_sub: body.kc_sub, dry_run: body.dry_run === true, blocked: 1,
          plan: changes.map(c => ({ project: c.project, before: 'owner', after: null, kind: 'remove',
            check: { state: 'forbidden', source: 'Это последний владелец проекта AIDA/solo. Без владельца проектом некому управлять.' } })),
          undo: [],
        });
      }
      return json({
        ok: true, kc_sub: body.kc_sub, dry_run: body.dry_run === true,
        plan: changes.map(c => ({ project: c.project, before: 'editor', after: null, kind: 'remove', check: { state: 'checked', source: 'graph' } })),
        undo: changes.map(c => ({ project: c.project, role: 'editor' })),
      });
    }
    const dis = /^\/lore\/kc\/agent-client\/([^/]+)\/(disable|enable)$/.exec(url);
    if (dis) {
      const on = dis[2] === 'enable';
      return json({ client_id: decodeURIComponent(dis[1]), ok: true, clientId: decodeURIComponent(dis[1]), enabled: on,
        kind: on ? 'enable' : 'disable', undo: { action: on ? 'disable' : 'enable' } });
    }
    const en = /^\/lore\/kc\/user\/([^/]+)\/enabled$/.exec(url);
    if (en && body) {
      const id = decodeURIComponent(en[1]);
      const u = (opts.users ?? KC_USERS).find(x => x.id === id);
      const before = u ? u.enabled : null;
      const after = body.enabled === true;
      const kind = before === after ? 'unchanged' : after ? 'enable' : 'disable';
      const check = opts.enabledForbidden
        ? { state: 'forbidden', source: opts.enabledForbidden }
        : { state: 'checked', source: 'keycloak' };
      const plan = { user_id: id, username: u?.username ?? null, before, after, kind, sign: after ? '+' : '−', check };
      if (body.dry_run === true) return json({ user_id: id, ok: true, dry_run: true, plan: [plan] });
      return json({ user_id: id, op_id: 'kr-1762891200000-0000abcd', ok: true, username: u?.username, enabled: after, kind,
        undo: kind === 'unchanged' ? null : { enabled: before }, undo_until: new Date(Date.now() + 15 * 60_000).toISOString(),
        sessions_logged_out: !after });
    }
    const rr = /^\/lore\/kc\/user\/([^/]+)\/role$/.exec(url);
    if (rr && body) {
      return json({ user_id: rr[1], ok: true, dry_run: true,
        plan: [{ role: body.role, before: true, after: false, kind: 'remove', check: { state: 'checked' } }] });
    }
    return json({ rows: [] });
  });
  return { f: f as unknown as typeof fetch, calls };
}

const mount = (kcSub: string, name: string, f: typeof fetch, meSub: string | null = null) => render(
  <KitLangProvider lang="ru">
    <PersonOffboard person={{ kc_sub: kcSub, name }} meSub={meSub} fetchImpl={f} onClose={() => {}} />
  </KitLangProvider>,
);

describe('UC-4 · модель', () => {
  it('роли человека: последний owner проекта отмечен, не последний — нет', () => {
    const anna = offRoleItems(roles(), 'u-anna');
    expect(anna.map(i => [i.project, i.role, i.lastOwner])).toEqual([
      ['AIDA/miniLORE', 'editor', false],
      ['NooriUta/UnlimitedLORE', 'owner', false],
    ]);
    const solo = offRoleItems(roles(), 'u-solo');
    expect(solo).toEqual([expect.objectContaining({ project: 'AIDA/solo', lastOwner: true })]);
    // boss — единственный owner volva, но не UnlimitedLORE (там ещё anna).
    expect(offRoleItems(roles(), 'u-boss').filter(i => i.lastOwner).map(i => i.project)).toEqual(['AIDA/volva']);
  });

  it('учётка KC: по id, иначе по логину; нет — null', () => {
    expect(findKcAccount(KC_USERS, 'u-anna', 'anna')?.username).toBe('anna');
    expect(findKcAccount(KC_USERS, 'boss', 'Босс')?.id).toBe('u-boss');
    expect(findKcAccount(KC_USERS, 'u-nobody', 'nobody')).toBeNull();
  });

  it('последний admin realm: считаются только ВКЛЮЧЁННЫЕ носители admin/super-admin', () => {
    const boss = KC_USERS[1];
    expect(isLastRealmAdmin(KC_USERS, boss)).toBe(false); // есть ещё solo
    const two = KC_USERS.filter(u => u.id !== 'u-solo');
    expect(isLastRealmAdmin(two, boss)).toBe(true); // gone выключен — не считается
    expect(isLastRealmAdmin(two, KC_USERS[0])).toBe(false); // у anna admin нет
  });

  it('realm-роли к снятию: служебные KC не в счёт, super-admin — вне моста (D11), последний admin — заблокирован', () => {
    const items = realmItems({ ...KC_USERS[1], roles: ['admin', 'super-admin', 'default-roles-lore'] }, REALM_ROLES, [KC_USERS[1]]);
    expect(items.map(i => [i.role, i.outOfBridge, i.lastAdmin])).toEqual([
      ['admin', false, true],
      ['super-admin', true, false],
    ]);
  });

  it('агенты: включённая учётка — снимется (проверено), выключенная — уже так, без учётки и нет в KC — не проверено', () => {
    const rows = agentDiffRows(agents().filter(a => a.owner_kc_subs.includes('u-anna')), parseKcClients(KC_CLIENTS), WORDS);
    expect(rows.map(r => [r.id, r.kind, r.check.state])).toEqual([
      ['lore-mcp-full_anna', 'remove', 'checked'],
      ['lore-mcp-full_old', 'same', 'checked'],
      ['AG-3', 'remove', 'unverified'],
    ]);
  });

  it('агенты: KC не прочитался — каждая строка «не проверено» с причиной, а не «пусто»', () => {
    const rows = agentDiffRows(agents().filter(a => a.owner_kc_subs.includes('u-anna')), { error: 'HTTP 503' }, WORDS);
    expect(rows.every(r => r.check.state === 'unverified')).toBe(true);
    expect(rows[0].check).toEqual({ state: 'unverified', reason: 'не смогли: HTTP 503' });
  });
});

describe('UC-4 · экран', () => {
  it('инвентаризация: учётка KC, роли в проектах, агенты — до любого действия', async () => {
    const { f } = fake();
    mount('u-anna', 'anna', f);
    await waitFor(() => expect(screen.getByTestId('adm-off-inv-kc').getAttribute('data-state')).toBe('ok'));
    expect(screen.getByTestId('adm-off-inv-kc').textContent).toContain('anna');
    await waitFor(() => expect(screen.getByTestId('adm-off-inv-roles').getAttribute('data-state')).toBe('ok'));
    expect(screen.getByTestId('adm-off-inv-roles').textContent).toContain('2');
    await waitFor(() => expect(screen.getByTestId('adm-off-inv-agents').getAttribute('data-state')).toBe('ok'));
    expect(screen.getByTestId('adm-off-inv-agents').textContent).toContain('3');
  });

  it('KC недоступен — «не смогли проверить» с причиной, а не «учётки нет»', async () => {
    const { f } = fake({ kcUsersStatus: 503 });
    mount('u-anna', 'anna', f);
    await waitFor(() => expect(screen.getByTestId('adm-off-inv-kc').getAttribute('data-state')).toBe('fail'));
    expect(screen.getByTestId('adm-off-inv-kc').textContent).toContain('мост KC не настроен');
  });

  it('учётки в KC нет (ответ получен) — отдельное состояние «не нашли»', async () => {
    const { f } = fake({ users: [KC_USERS[1]] });
    mount('u-anna', 'anna', f);
    await waitFor(() => expect(screen.getByTestId('adm-off-inv-kc').getAttribute('data-state')).toBe('none'));
  });

  it('роли: одна кнопка → DangerBatch с dry_run на снятие ВСЕХ ролей человека', async () => {
    const { f, calls } = fake();
    mount('u-anna', 'anna', f);
    fireEvent.click(await screen.findByTestId('adm-off-roles-remove'));
    await screen.findByTestId('adm-danger');
    await waitFor(() => expect(calls.some(c => c.url === '/lore/user/role/batch')).toBe(true));
    const dry = calls.find(c => c.url === '/lore/user/role/batch')!.body!;
    expect(dry.dry_run).toBe(true);
    expect(dry.kc_sub).toBe('u-anna');
    expect(dry.changes).toEqual([
      { project: 'AIDA/miniLORE', action: 'remove' },
      { project: 'NooriUta/UnlimitedLORE', action: 'remove' },
    ]);
  });

  it('последний owner проекта — отказ AL-100 строкой плана сервера (dry_run): строка «нельзя» с причиной, не применяется', async () => {
    const { f, calls } = fake();
    mount('u-solo', 'solo', f);
    const btn = await screen.findByTestId('adm-off-roles-remove');
    // Подсказка из среза видна до диффа, но решает сервер: кнопка не заперта догадкой клиента.
    expect(screen.getByTestId('adm-off-roles-blocked').textContent).toMatch(/последний владелец проекта AIDA\/solo/);
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    const row = await screen.findByTestId('kit-diff-row-AIDA/solo');
    expect(row.getAttribute('data-check')).toBe('forbidden');
    expect(row.textContent).toMatch(/последний владелец проекта AIDA\/solo/);
    expect(calls.filter(c => c.url === '/lore/user/role/batch').every(c => c.body?.dry_run === true)).toBe(true);
  });

  it('последний носитель realm admin — снятие admin заблокировано с объяснением AL-35', async () => {
    const { f } = fake({ users: [KC_USERS[0], KC_USERS[1], KC_USERS[3]] });
    mount('u-boss', 'boss', f);
    const btn = await screen.findByTestId('adm-off-realm-remove-admin');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('adm-off-realm-blocked-admin').textContent).toMatch(/последняя включённая учётка с ролью admin/);
  });

  it('realm-роль не последняя — снимается существующим путём KcDanger (dry_run)', async () => {
    const { f, calls } = fake();
    mount('u-anna', 'anna', f);
    const btn = await screen.findByTestId('adm-off-realm-remove-viewer');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    await screen.findByTestId('adm-realm-danger');
    await waitFor(() => expect(calls.some(c => c.url === '/lore/kc/user/u-anna/role')).toBe(true));
    expect(calls.find(c => c.url === '/lore/kc/user/u-anna/role')!.body).toEqual({ role: 'viewer', action: 'remove', dry_run: true });
  });

  it('агенты: дифф, ввод логина, отключение только проверенных включённых; «вернуть можно» сказано до применения', async () => {
    const { f, calls } = fake();
    mount('u-anna', 'anna', f);
    const box = await screen.findByTestId('adm-off-agents');
    await within(box).findByTestId('kit-diff-row-lore-mcp-full_anna');
    expect(screen.getByTestId('adm-off-agents-reversible')).toBeTruthy();
    expect(screen.queryByTestId('adm-off-agents-noundo')).toBeNull();
    fireEvent.change(within(box).getByTestId('kit-diff-confirm'), { target: { value: 'anna' } });
    fireEvent.click(within(box).getByTestId('kit-diff-apply'));
    await within(box).findByTestId('kit-batch');
    const disables = calls.filter(c => c.url.endsWith('/disable')).map(c => c.url);
    expect(disables).toEqual(['/lore/kc/agent-client/lore-mcp-full_anna/disable']);
  });

  it('агенты: «Отменить» после отключения включает учётки обратно (agent-client/…/enable)', async () => {
    const { f, calls } = fake();
    mount('u-anna', 'anna', f);
    const box = await screen.findByTestId('adm-off-agents');
    await within(box).findByTestId('kit-diff-row-lore-mcp-full_anna');
    fireEvent.change(within(box).getByTestId('kit-diff-confirm'), { target: { value: 'anna' } });
    fireEvent.click(within(box).getByTestId('kit-diff-apply'));
    fireEvent.click(await within(box).findByTestId('kit-batch-undo'));
    await within(box).findByTestId('kit-batch-undone');
    expect(calls.filter(c => c.url.endsWith('/enable')).map(c => c.url)).toEqual(['/lore/kc/agent-client/lore-mcp-full_anna/enable']);
  });

  it('это вы — отключать себя нельзя: кнопки заблокированы с причиной', async () => {
    const { f } = fake();
    mount('u-anna', 'anna', f, 'u-anna');
    expect(await screen.findByTestId('adm-off-self')).toBeTruthy();
    const btn = await screen.findByTestId('adm-off-roles-remove');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('UC-4 · учётка человека в Keycloak (серверные хвосты S7B-20)', () => {
  const kcStep = () => window.history.replaceState(null, '', '/?adm-off-step=kc');
  const enabledCalls = (calls: Array<{ url: string; body: Record<string, unknown> | null }>, id: string) =>
    calls.filter(c => c.url === `/lore/kc/user/${id}/enabled`).map(c => c.body);

  it('модель: роли учётки не прочитались — rolesChecked:false, и «последний admin» не утверждаем', () => {
    const users = parseKcUsers([
      { id: 'u-boss', username: 'boss', enabled: true, roles: ['admin'], roles_checked: true },
      { id: 'u-x', username: 'x', enabled: true, roles: [], roles_checked: false },
    ]);
    expect(users.map(u => u.rolesChecked)).toEqual([true, false]);
    // У x роли неизвестны — может быть ещё один admin; решит сервер (AL-35).
    expect(isLastRealmAdmin(users, users[0])).toBe(false);
  });

  it('«Выключить учётку»: дифф сервера (dry_run) → логин → выключение; «Отменить» включает обратно (undo_of)', async () => {
    const { f, calls } = fake();
    kcStep();
    mount('u-anna', 'anna', f);
    fireEvent.click(await screen.findByTestId('adm-off-kc-disable'));
    const box = await screen.findByTestId('adm-off-kc-enabled');
    await within(box).findByTestId('kit-diff-row-u-anna');
    expect(enabledCalls(calls, 'u-anna')).toEqual([{ enabled: false, dry_run: true }]);
    fireEvent.change(within(box).getByTestId('kit-diff-confirm'), { target: { value: 'anna' } });
    fireEvent.click(within(box).getByTestId('kit-diff-apply'));
    fireEvent.click(await within(box).findByTestId('kit-batch-undo'));
    await within(box).findByTestId('kit-batch-undone');
    expect(enabledCalls(calls, 'u-anna').slice(1)).toEqual([
      { enabled: false },
      { enabled: true, undo_of: 'kr-1762891200000-0000abcd' },
    ]);
  });

  it('последний админ — строка диффа «нельзя» словами сервера (AL-35), применять нечего', async () => {
    const { f, calls } = fake({ enabledForbidden: 'это последняя включённая учётка с ролью admin/super-admin (AL-35)' });
    kcStep();
    mount('u-boss', 'boss', f);
    fireEvent.click(await screen.findByTestId('adm-off-kc-disable'));
    const row = await screen.findByTestId('kit-diff-row-u-boss');
    expect(row.getAttribute('data-check')).toBe('forbidden');
    expect(row.textContent).toContain('AL-35');
    expect(enabledCalls(calls, 'u-boss').every(b => b?.dry_run === true)).toBe(true);
  });

  it('учётка уже выключена — «Включить обратно», дифф на включение', async () => {
    const { f, calls } = fake({ users: [{ ...KC_USERS[0], enabled: false }, KC_USERS[1]] });
    kcStep();
    mount('u-anna', 'anna', f);
    expect(screen.queryByTestId('adm-off-kc-disable')).toBeNull();
    fireEvent.click(await screen.findByTestId('adm-off-kc-enable'));
    await screen.findByTestId('kit-diff-row-u-anna');
    expect(enabledCalls(calls, 'u-anna')).toEqual([{ enabled: true, dry_run: true }]);
  });

  it('это вы — выключить свою учётку нельзя: кнопка заблокирована', async () => {
    const { f } = fake();
    kcStep();
    mount('u-anna', 'anna', f, 'u-anna');
    expect((await screen.findByTestId('adm-off-kc-disable') as HTMLButtonElement).disabled).toBe(true);
  });

  it('«осталось руками» больше не просит выключить учётку в консоли KC — это делает LORE', async () => {
    const { f } = fake();
    kcStep();
    mount('u-anna', 'anna', f);
    await screen.findByTestId('adm-off-kc-disable');
    expect(screen.queryByText(/Выключить саму учётку человека в Keycloak/)).toBeNull();
  });

  it('учёток больше 100 — список полный, оговорки «первые 100» нет', async () => {
    const many: KcUser[] = Array.from({ length: 150 }, (_, i) => ({ id: `u-${i}`, username: `user${i}`, email: null, enabled: true, roles: [] }));
    const { f } = fake({ users: many });
    kcStep();
    mount('u-nobody', 'nobody', f);
    await screen.findByTestId('adm-off-kc-none');
    expect(screen.queryByText(/первые 100/)).toBeNull();
  });
});

describe('UC-4 · допуски к машинам (S7B-ACL-1)', () => {
  const acl = () => parseMachineAcl(MACHINE_ACL);

  it('модель: машины, которыми владеет, и машины, к которым допущен, — раздельно', () => {
    const items = offMachineItems(acl(), 'u-anna');
    expect(items.owned.map(m => m.machine_id)).toEqual(['anna-pc']);
    expect(items.granted.map(g => [g.machine.machine_id, g.role, g.projects])).toEqual([['boss-pc', 'actor', ['AIDA/miniLORE']]]);
    expect(offMachineItems(acl(), 'u-nobody')).toEqual({ owned: [], granted: [] });
  });

  it('модель: снятие — revoke на каждый допуск; владение запросом не снимается', () => {
    expect(revokeMachineRequests(offMachineItems(acl(), 'u-anna'), 'u-anna')).toEqual([
      { machine_id: 'boss-pc', kc_sub: 'u-anna', action: 'revoke' },
    ]);
  });

  it('инвентаризация: машины читаются срезом machine_acl с фильтром kc_sub, числа видны', async () => {
    const { f, calls } = fake();
    mount('u-anna', 'anna', f);
    await waitFor(() => expect(screen.getByTestId('adm-off-inv-machines').getAttribute('data-state')).toBe('ok'));
    const acl = calls.find(c => c.url.startsWith('/lore/slice/machine_acl'))!;
    expect(new URL(acl.url, 'http://x').searchParams.get('kc_sub')).toBe('u-anna');
    expect(screen.getByTestId('adm-off-inv-machines').textContent).toMatch(/владеет 1.*допущен к 1/);
  });

  it('срез недоступен — «нет прав» с причиной, а не «машин нет»', async () => {
    const { f } = fake({ aclStatus: 403 });
    mount('u-anna', 'anna', f);
    await waitFor(() => expect(screen.getByTestId('adm-off-inv-machines').getAttribute('data-state')).toBe('fail'));
    expect(screen.getByTestId('adm-off-inv-machines').textContent).toContain('нет прав на срез');
  });

  it('шаг «Машины»: план сервера (dry_run) → дифф → revoke допуска; владение — в «осталось руками»', async () => {
    const { f, calls } = fake();
    window.history.replaceState(null, '', '/?adm-off-step=machines');
    mount('u-anna', 'anna', f);
    const box = await screen.findByTestId('adm-off-machines');
    expect(within(box).getByTestId('adm-off-machines-owned').textContent).toContain('anna-pc');
    fireEvent.click(within(box).getByTestId('adm-off-machines-revoke'));
    await within(box).findByTestId('adm-macl-change');
    await waitFor(() => expect(calls.some(c => c.url === '/lore/user/machine-access' && c.body?.dry_run === true)).toBe(true));
    // Строку диффа называет машина, а не имя человека (все строки — один человек).
    const row = await within(box).findByTestId('kit-diff-row-0');
    expect(row.textContent).toContain('boss-pc');
    fireEvent.click(within(box).getByTestId('kit-diff-apply'));
    await within(box).findByTestId('kit-batch');
    const applied = calls.filter(c => c.url === '/lore/user/machine-access' && c.body?.dry_run !== true).map(c => c.body);
    // S7B-ACL-3 (#1255): допуски уходят пачкой по машине — {machine_id, items:[…]}, не запросом на допуск.
    expect(applied).toEqual([{ machine_id: 'boss-pc', items: [{ kc_sub: 'u-anna', action: 'revoke' }] }]);
  });

  it('это вы — снятие допусков к машинам заблокировано', async () => {
    const { f } = fake();
    window.history.replaceState(null, '', '/?adm-off-step=machines');
    mount('u-anna', 'anna', f, 'u-anna');
    const btn = await screen.findByTestId('adm-off-machines-revoke');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('UC-4 · вход из паспорта человека (S7B-28)', () => {
  it('в паспорте человека — «Отключить…», открывает инвентаризацию, человек в адресе', async () => {
    const { f } = fake();
    window.history.replaceState(null, '', '/?adm-open=u-anna');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={f} /></KitLangProvider>);
    fireEvent.click(await screen.findByTestId('adm-off-open-u-anna'));
    expect(await screen.findByTestId('adm-off')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('adm-off')).toBe('u-anna');
  });

  it('ссылка ?adm-off=… открывает инвентаризацию сразу; «Закрыть» убирает её из адреса', async () => {
    const { f } = fake();
    window.history.replaceState(null, '', '/?adm-open=u-anna&adm-off=u-anna');
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={f} /></KitLangProvider>);
    fireEvent.click(await screen.findByTestId('adm-off-close'));
    await waitFor(() => expect(screen.queryByTestId('adm-off')).toBeNull());
    expect(new URLSearchParams(window.location.search).get('adm-off')).toBeNull();
  });
});
