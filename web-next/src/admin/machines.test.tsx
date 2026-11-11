// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-ACL-3 — «Доступ к машинам»: список машин, паспорт
// машины (допуски, «допустить»), блок «Машины» в паспорте человека, матрица
// проекта. Прототип docs/prototypes/s7b-acl3-machine-access-v3.html.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import {
  enrichMachines, grantRecords, inverseRequest, machineRecords, parseMachineAcl, personMachines,
  projectMatrix, removeProjectsRequests, roleRequests, splitPair,
} from './machines';
import { buildParticipation } from './participation';
import { parseAgents } from './agents';
import { MachinesScreen, PersonMachines } from './MachinesScreen';
import { AdminNavProvider } from './adminNav';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const ACL = [
  {
    actor_id: 'AG-M1', client_id: 'minilore-link-ar-matebook', machine_id: 'ar-matebook', name: 'ar-matebook',
    owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'],
    grant_kc_subs: ['u-fro', 'u-li'], grant_display_names: ['frolova', 'lisa'],
    grant_roles: ['actor', 'viewer'], grant_projects: [['AIDA/miniLORE', 'NooriUta/UnlimitedLORE'], ['AIDA/miniLORE']],
    grant_harnesses: [[], ['claude-code']], grant_granted_by: ['u-ar', 'u-ar'], grant_granted_at: ['2026-11-10T10:00:00Z', '2026-11-11T09:00:00Z'],
  },
  {
    actor_id: 'AG-M2', client_id: 'minilore-link-li-ws', machine_id: null, name: 'li-ws',
    owner_kc_sub: ['u-li'], owner_display_name: ['lisa'],
    grant_kc_subs: [], grant_display_names: [], grant_roles: [], grant_projects: [], grant_harnesses: [], grant_granted_by: [], grant_granted_at: [],
  },
];
const MATRIX = [
  { kc_sub: 'u-ar', display_name: 'arharaga', projects: ['AIDA/miniLORE', 'NooriUta/UnlimitedLORE'], roles: ['owner', 'owner'] },
  { kc_sub: 'u-fro', display_name: 'frolova', projects: ['AIDA/miniLORE'], roles: ['reader'] },
  { kc_sub: 'u-li', display_name: 'lisa', projects: ['AIDA/miniLORE'], roles: ['reader'] },
  { kc_sub: 'u-vo', display_name: 'volkov', projects: ['NooriUta/UnlimitedLORE'], roles: ['reader'] },
  { kc_sub: 'u-out', display_name: 'outsider', projects: ['BRAGI'], roles: ['reader'] },
];
const AGENTS = [
  { actor_id: 'AG-M1', name: 'ar-matebook', client_id: 'minilore-link-ar-matebook', agent_role: 'full', harness: 'claude-code', machine_id: 'ar-matebook', owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'] },
  { actor_id: 'AG-K', name: 'Kimi', client_id: 'lore-mcp-full_kimi', agent_role: 'full', harness: 'kimi-code', machine_id: 'ar-matebook', owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'] },
  { actor_id: 'AG-M2', name: 'li-ws', client_id: 'minilore-link-li-ws', agent_role: 'full', harness: 'codex', machine_id: 'li-ws', owner_kc_sub: ['u-li'], owner_display_name: ['lisa'] },
];

const machines = () => enrichMachines(parseMachineAcl(ACL), buildParticipation(MATRIX, parseAgents({ rows: AGENTS } as never).rows), parseAgents({ rows: AGENTS } as never).rows);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
type Post = { machine_id: string; kc_sub: string; action: string; role?: string; projects?: string[]; harnesses?: string[]; dry_run?: boolean };
function fake(opts: { aclStatus?: number; write?: 'ok' | 'forbidden' } = {}) {
  const posts: Post[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/lore/slice/machine_acl')) return opts.aclStatus ? json({ error: 'FORBIDDEN', detail: 'нет прав на срез' }, opts.aclStatus) : json({ rows: ACL });
    if (url.startsWith('/lore/slice/role_matrix')) return json({ rows: MATRIX });
    if (url.startsWith('/lore/slice/agent_owners')) return json({ rows: AGENTS });
    if (url.startsWith('/lore/user/machine-access')) {
      const b = JSON.parse(String(init?.body)) as Post;
      posts.push(b);
      if (opts.write === 'forbidden') return json({ error: 'MACHINE_ACCESS_FORBIDDEN', detail: 'допуск к машине выдаёт только её владелец или admin' }, 403);
      const before = b.kc_sub === 'u-fro' ? { role: 'actor', projects: ['AIDA/miniLORE', 'NooriUta/UnlimitedLORE'], harnesses: [] } : null;
      const after = b.action === 'revoke' ? null : { role: b.role, projects: b.projects, harnesses: b.harnesses ?? [] };
      const kind = b.action === 'revoke' ? (before ? 'revoke' : 'unchanged') : before ? 'update' : 'grant';
      return json({ machine_id: b.machine_id, ok: true, plan: { kc_sub: b.kc_sub, kind, before, after }, ...(b.dry_run ? { dry_run: true } : { outcome: 'CREATED' }) });
    }
    return json({ rows: [] });
  }) as unknown as typeof fetch;
  return { f, posts };
}
const wrap = (ui: React.ReactNode) => render(<KitLangProvider lang="ru">{ui}</KitLangProvider>);

describe('S7B-ACL-3 · модель', () => {
  it('machine_acl: допуски по позиции массивов, владелец из массива, имя машины из client_id', () => {
    const [m1, m2] = parseMachineAcl(ACL);
    expect(m1.machine_id).toBe('ar-matebook');
    expect(m2.machine_id).toBe('li-ws');
    expect(m1.owner_kc_sub).toBe('u-ar');
    expect(m1.grants.map(g => [g.kc_sub, g.role, g.projects, g.harnesses])).toEqual([
      ['u-fro', 'actor', ['AIDA/miniLORE', 'NooriUta/UnlimitedLORE'], []],
      ['u-li', 'viewer', ['AIDA/miniLORE'], ['claude-code']],
    ]);
  });

  it('проекты машины — проекты владельца ∪ проекты допусков; harness — у машины и её агентов', () => {
    const [m1, m2] = machines();
    expect(m1.projects).toEqual(['AIDA/miniLORE', 'NooriUta/UnlimitedLORE']);
    expect(m1.harness).toEqual(['claude-code', 'kimi-code']);
    expect(m2.projects).toEqual(['AIDA/miniLORE']);
  });

  it('участие не прочиталось — проекты из допусков остаются, а не «проектов нет»', () => {
    const [m1] = enrichMachines(parseMachineAcl(ACL), null, []);
    expect(m1.projects).toEqual(['AIDA/miniLORE', 'NooriUta/UnlimitedLORE']);
  });

  it('группировка по проекту: машина с двумя проектами — в обеих группах', () => {
    const ids = machineRecords(machines(), true).map(r => r.id).map(splitPair);
    expect(ids.filter(([m]) => m === 'ar-matebook').map(([, p]) => p)).toEqual(['AIDA/miniLORE', 'NooriUta/UnlimitedLORE']);
    expect(machineRecords(machines()).map(r => r.id)).toEqual(['ar-matebook', 'li-ws']);
  });

  it('допуски — строка на «человек × проект»: frolova в двух группах', () => {
    const recs = grantRecords(machines()[0]);
    expect(recs.map(r => [r.title, r.fields.project])).toEqual([
      ['frolova', 'AIDA/miniLORE'], ['frolova', 'NooriUta/UnlimitedLORE'], ['lisa', 'AIDA/miniLORE'],
    ]);
  });

  it('«Снять» у строки снимает проект; ушёл последний — допуск снимается целиком', () => {
    const m = machines()[0];
    expect(removeProjectsRequests(m, [['u-fro', 'AIDA/miniLORE'], ['u-li', 'AIDA/miniLORE']])).toEqual([
      { machine_id: 'ar-matebook', kc_sub: 'u-fro', display_name: 'frolova', action: 'grant', role: 'actor', projects: ['NooriUta/UnlimitedLORE'], harnesses: [] },
      { machine_id: 'ar-matebook', kc_sub: 'u-li', action: 'revoke' },
    ]);
  });

  it('«Сменить роль» — проекты и harness как были; отмена по плану возвращает «было»', () => {
    const [req] = roleRequests(machines()[0], ['u-li', 'u-li'], 'actor');
    expect(req).toMatchObject({ kc_sub: 'u-li', role: 'actor', projects: ['AIDA/miniLORE'], harnesses: ['claude-code'] });
    expect(inverseRequest(req, { kind: 'grant', before: null, after: null })).toEqual({ machine_id: 'ar-matebook', kc_sub: 'u-li', action: 'revoke' });
    expect(inverseRequest(req, { kind: 'update', before: { role: 'viewer', projects: ['AIDA/miniLORE'], harnesses: ['claude-code'] }, after: null }))
      .toMatchObject({ action: 'grant', role: 'viewer' });
  });

  it('человек: машины, которыми владеет, и к которым допущен', () => {
    const { owned, granted } = personMachines(machines(), 'u-li');
    expect(owned.map(x => x.machine.machine_id)).toEqual(['li-ws']);
    expect(granted.map(x => [x.machine.machine_id, x.role])).toEqual([['ar-matebook', 'viewer']]);
  });

  it('матрица проекта: владелец / пишет / видит / нет; «без доступа ни к одной машине»', () => {
    const p = buildParticipation(MATRIX, []);
    const mx = projectMatrix(machines(), p, 'NooriUta/UnlimitedLORE');
    expect(mx.machines.map(m => m.machine_id)).toEqual(['ar-matebook']);
    expect(mx.mark('u-ar', 'ar-matebook')).toBe('owner');
    expect(mx.mark('u-fro', 'ar-matebook')).toBe('actor');
    expect(mx.noAccess).toEqual(['u-vo']);
    const mini = projectMatrix(machines(), p, 'AIDA/miniLORE');
    expect(mini.mark('u-li', 'ar-matebook')).toBe('viewer');
    expect(mini.mark('u-li', 'li-ws')).toBe('owner');
  });
});

describe('S7B-ACL-3 · экран', () => {
  it('список машин — kit ListView: машины, владелец; строка открывает паспорт, выбор в адресе', async () => {
    const { f } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ar" />);
    const row = await screen.findByRole('button', { name: 'ar-matebook' });
    expect(document.querySelector('[data-record-id="li-ws"]')).toBeTruthy();
    fireEvent.click(row);
    expect(new URLSearchParams(window.location.search).get('adm-macl-m')).toBe('ar-matebook');
    expect(await screen.findByTestId('adm-macl-passport-ar-matebook')).toBeTruthy();
  });

  it('machine_acl отдал 403 — «нет прав» явно, а не «машин нет»', async () => {
    const { f } = fake({ aclStatus: 403 });
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ar" />);
    expect(await screen.findByTestId('adm-macl-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('adm-macl-empty')).toBeNull();
  });

  it('паспорт: шапка (client_id, владелец, harness, проекты), допуски по проектам', async () => {
    window.history.replaceState(null, '', '/?adm-macl-m=ar-matebook');
    const { f } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ar" />);
    const pass = await screen.findByTestId('adm-macl-passport-ar-matebook');
    expect(pass.textContent).toContain('minilore-link-ar-matebook');
    expect(pass.textContent).toContain('arharaga');
    expect(pass.textContent).toContain('claude-code');
    const grants = within(pass).getByTestId('adm-macl-grants');
    expect(grants.querySelectorAll('[data-record-id]').length).toBe(3);
  });

  it('не владелец и не admin (сервер 403 на пробе) — только чтение, формы «Допустить» нет', async () => {
    window.history.replaceState(null, '', '/?adm-macl-m=ar-matebook');
    const { f } = fake({ write: 'forbidden' });
    wrap(<MachinesScreen fetchImpl={f} meSub="u-fro" />);
    const ro = await screen.findByTestId('adm-macl-readonly');
    expect(ro.textContent).toContain('владелец или admin');
    expect(screen.queryByTestId('adm-macl-grant')).toBeNull();
  });

  it('владелец: «вся команда проекта» → DiffPreview по dry_run → применить → BatchUndo → отмена шлёт обратное', async () => {
    window.history.replaceState(null, '', '/?adm-macl-m=ar-matebook');
    const { f, posts } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ar" />);
    const form = await screen.findByTestId('adm-macl-grant');
    fireEvent.click(within(form).getByTestId('adm-macl-team-AIDA/miniLORE'));
    fireEvent.click(within(form).getByTestId('adm-macl-preview'));
    const change = await screen.findByTestId('adm-macl-change');
    await waitFor(() => expect(within(change).getAllByText(/frolova|lisa/).length).toBeGreaterThan(0));
    // Владельцу допуск не выдаётся — его в пачке нет.
    expect(posts.filter(p => p.dry_run && p.kc_sub === 'u-ar')).toEqual([]);
    const apply = within(change).getByRole('button', { name: /Применить/ });
    fireEvent.click(apply);
    const undo = await screen.findByTestId('kit-batch-undo');
    expect(posts.filter(p => !p.dry_run).map(p => p.kc_sub).sort()).toEqual(['u-fro', 'u-li']);
    fireEvent.click(undo);
    await screen.findByTestId('kit-batch-undone');
    const undos = posts.filter(p => !p.dry_run).slice(2);
    expect(undos.find(p => p.kc_sub === 'u-li')).toMatchObject({ action: 'revoke' });
    expect(undos.find(p => p.kc_sub === 'u-fro')).toMatchObject({ action: 'grant', role: 'actor' });
  });

  it('матрица проекта — kit Matrix; люди без доступа отмечены', async () => {
    window.history.replaceState(null, '', '/?adm-macl-tab=matrix&adm-macl-xp=NooriUta%2FUnlimitedLORE');
    const { f } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ar" />);
    const mx = await screen.findByTestId('adm-macl-matrix');
    expect(mx.querySelector('[data-testid="kit-matrix"], .sk-matrix')).toBeTruthy();
    expect(screen.getByTestId('adm-macl-noaccess').textContent).toContain('1');
    expect(mx.textContent).toContain('volkov');
  });
});

describe('S7B-ACL-3 · паспорт человека', () => {
  it('блок «Машины»: владеет и допущен, с ролью и проектами; щелчок открывает паспорт машины', async () => {
    const { f } = fake();
    const go = vi.fn();
    wrap(<AdminNavProvider value={{ go }}><PersonMachines kcSub="u-li" fetchImpl={f} /></AdminNavProvider>);
    const block = await screen.findByTestId('adm-person-machines');
    await waitFor(() => expect(block.querySelectorAll('[data-record-id]').length).toBe(2));
    expect(block.textContent).toContain('li-ws');
    expect(block.textContent).toContain('ar-matebook');
    fireEvent.click(within(block).getByRole('button', { name: 'ar-matebook' }));
    expect(go).toHaveBeenCalledWith('machines', { 'adm-macl-m': 'ar-matebook' });
  });

  it('машины не прочитались — блок говорит об ошибке, а не «машин нет»', async () => {
    const { f } = fake({ aclStatus: 502 });
    wrap(<PersonMachines kcSub="u-li" fetchImpl={f} />);
    expect(await screen.findByTestId('adm-person-machines-error')).toBeTruthy();
  });
});
