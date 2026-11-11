// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-ACT-1 — порог активности машины и harness (1..24 ч).
//
// Слово владелицы 11.11: «по DSH предлагаю в админку на машину и harness выставить настройки
// (считать активной в течении — от часа после последнего вызова до суток)».
//
// Сервер: поля activity_window_h / activity_window_harness актора-машины в срезах machine_acl и
// agent_owners, last_seen_at и activity_default_h в machine_acl; запись — POST
// /lore/user/machine-activity (dry_run → план «было → станет»), пишет владелец машины или admin.
// Клиент: колонка kit «когда был на связи» (fresh:last_seen) с порогом СТРОКИ — окном её машины.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { activityWindowH, machineRecords, parseMachineAcl } from './machines';
import { agentWindow, parseAgents } from './agents';
import { MachinesScreen } from './MachinesScreen';
import { AgentsScreen } from './AgentsScreen';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); vi.useRealTimers(); });

const NOW = Date.parse('2026-11-11T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const ACL = [
  {
    actor_id: 'AG-M1', client_id: 'minilore-link-day', machine_id: 'day', name: 'day',
    owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'],
    grant_kc_subs: [], grant_display_names: [], grant_roles: [], grant_projects: [], grant_harnesses: [], grant_granted_by: [], grant_granted_at: [],
    activity_window_h: 24, activity_window_harness: { dsh: 3 }, last_seen_at: ago(125), activity_default_h: 1,
    projects: [], harnesses: ['claude-code', 'dsh'], can_write: true,
  },
  {
    actor_id: 'AG-M2', client_id: 'minilore-link-hour', machine_id: 'hour', name: 'hour',
    owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'],
    grant_kc_subs: [], grant_display_names: [], grant_roles: [], grant_projects: [], grant_harnesses: [], grant_granted_by: [], grant_granted_at: [],
    activity_window_h: null, activity_window_harness: null, last_seen_at: ago(125), activity_default_h: 1,
    projects: [], harnesses: [], can_write: false,
  },
];

const AGENTS = [
  { actor_id: 'AG-M1', name: 'day', client_id: 'minilore-link-day', harness: null, machine_id: 'day', owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'],
    activity_window_h: 24, activity_window_harness: { dsh: 3 }, activity_default_h: 1, session_activity: [] },
  { actor_id: 'AG-C', name: 'Claude', client_id: 'lore-mcp-full_day', harness: 'claude-code', machine_id: 'day', owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'],
    activity_window_h: null, activity_window_harness: null, activity_default_h: 1, session_activity: [ago(600), ago(125)] },
  { actor_id: 'AG-D', name: 'DSH', client_id: 'lore-mcp-full_dsh', harness: 'dsh', machine_id: 'day', owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'],
    activity_window_h: null, activity_window_harness: null, activity_default_h: 1, session_activity: [ago(200)] },
  { actor_id: 'AG-N', name: 'Nomad', client_id: 'lore-mcp-full_nomad', harness: 'codex', machine_id: null, owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'],
    activity_window_h: null, activity_window_harness: null, activity_default_h: 1, session_activity: null },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
type ActPost = { machine_id: string; window_h: number | null; harness: Record<string, number>; dry_run?: boolean };
function fake() {
  const posts: ActPost[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/lore/slice/machine_acl')) return json({ rows: ACL });
    if (url.startsWith('/lore/slice/agent_owners')) return json({ rows: AGENTS });
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [{ code: 'claude-code', label_ru: 'Claude Code' }, { code: 'dsh', label_ru: 'DSH' }] });
    if (url.startsWith('/lore/user/machine-activity')) {
      const b = JSON.parse(String(init?.body)) as ActPost;
      posts.push(b);
      const plan = { kind: 'update', before: { window_h: 24, harness: { dsh: 3 } }, after: { window_h: b.window_h, harness: b.harness }, default_h: 1 };
      return json({ machine_id: b.machine_id, ok: true, plan, ...(b.dry_run ? { dry_run: true } : { outcome: 'UPDATED' }) });
    }
    return json({ rows: [] });
  }) as unknown as typeof fetch;
  return { f, posts };
}
const wrap = (ui: React.ReactNode) => render(<KitLangProvider lang="ru">{ui}</KitLangProvider>);

describe('S7B-ACT-1 · модель', () => {
  it('machine_acl: окно машины, окна по harness, last_seen_at и общий дефолт — из среза', () => {
    const [day, hour] = parseMachineAcl(ACL);
    expect(day.activity).toEqual({ windowH: 24, harness: { dsh: 3 } });
    expect(day.last_seen_at).toBe(ago(125));
    expect(hour.activity).toEqual({ windowH: null, harness: {} });
    expect(hour.default_h).toBe(1);
    const old = parseMachineAcl([{ ...ACL[0], last_seen_at: undefined, activity_default_h: undefined }])[0];
    expect(old.last_seen_at).toBeUndefined();
  });

  it('окно: harness → машина → общий дефолт (то же правило, что MachineActivity.effective)', () => {
    const a = { windowH: 24, harness: { dsh: 3 } };
    expect(activityWindowH(a, 'dsh', 1)).toEqual({ hours: 3, basis: 'harness' });
    expect(activityWindowH(a, 'claude-code', 1)).toEqual({ hours: 24, basis: 'machine' });
    expect(activityWindowH({ windowH: null, harness: {} }, null, 1)).toEqual({ hours: 1, basis: 'default' });
  });

  it('записи списка: last_seen и порог строки stale_min = окно машины в минутах', () => {
    const recs = machineRecords(parseMachineAcl(ACL));
    expect(recs[0].fields.last_seen).toBe(ago(125));
    expect(recs[0].fields.stale_min).toBe(24 * 60);
    expect(recs[1].fields.stale_min).toBe(60);
  });

  it('агент: окно — его машины с перекрытием по его harness; «на связи» — последняя активность сессий', () => {
    const rows = parseAgents({ rows: AGENTS } as never).rows;
    const by = (id: string) => rows.find(r => r.actor_id === id)!;
    expect(by('AG-C').last_seen_at).toBe(ago(125));
    expect(agentWindow(by('AG-C'), rows)).toMatchObject({ hours: 24, basis: 'machine', machine: 'day' });
    expect(agentWindow(by('AG-D'), rows)).toMatchObject({ hours: 3, basis: 'harness' });
    expect(agentWindow(by('AG-N'), rows)).toMatchObject({ hours: 1, basis: 'default', machine: null });
    expect(by('AG-N').last_seen_at).toBeNull();
  });
});

describe('S7B-ACT-1 · «Доступ к машинам»', () => {
  it('колонка «на связи»: одна давность — у машины с окном сутки «ok», с общим окном час «устарело»', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { f } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ar" />);
    await screen.findByRole('button', { name: 'day' });
    const tone = (id: string) => document.querySelector(`[data-record-id="${id}"] .sk-fresh`)?.getAttribute('data-tone');
    expect(tone('day')).toBe('ok');
    expect(tone('hour')).toBe('stale');
  });

  it('паспорт: окно машины и по harness видно; владелец меняет — dry_run → дифф → применить', async () => {
    window.history.replaceState(null, '', '/?adm-macl-m=day');
    const { f, posts } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-ar" />);
    const box = await screen.findByTestId('adm-act');
    expect(box.textContent).toContain('24 ч');
    expect(box.textContent).toContain('DSH');
    fireEvent.click(within(within(box).getByRole('group', { name: 'Окно машины' })).getByRole('button', { name: '12 ч' }));
    fireEvent.click(within(box).getByTestId('adm-act-preview'));
    const diff = await within(box).findByTestId('adm-act-diff');
    expect(posts).toEqual([{ machine_id: 'day', window_h: 12, harness: { dsh: 3 }, dry_run: true }]);
    fireEvent.click(within(diff).getByRole('button', { name: /Применить/ }));
    await waitFor(() => expect(posts.filter(p => !p.dry_run)).toEqual([{ machine_id: 'day', window_h: 12, harness: { dsh: 3 } }]));
  });

  it('can_write=false — окно видно, правки нет, причина словами', async () => {
    window.history.replaceState(null, '', '/?adm-macl-m=hour');
    const { f, posts } = fake();
    wrap(<MachinesScreen fetchImpl={f} meSub="u-li" />);
    const box = await screen.findByTestId('adm-act');
    expect(box.textContent).toContain('1 ч');
    expect(within(box).queryByTestId('adm-act-preview')).toBeNull();
    expect(posts).toEqual([]);
  });
});

describe('S7B-ACT-1 · «Агенты»', () => {
  it('колонка «на связи» — kit FreshCell с порогом окна машины агента', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { f } = fake();
    wrap(<AgentsScreen fetchImpl={f} />);
    const claude = await screen.findByTestId('adm-agent-AG-C');
    expect(claude.querySelector('.sk-fresh')?.getAttribute('data-tone')).toBe('ok');
    const dsh = screen.getByTestId('adm-agent-AG-D');
    expect(dsh.querySelector('.sk-fresh')?.getAttribute('data-tone')).toBe('stale');
    expect(screen.getByTestId('adm-agent-AG-N').querySelector('.sk-fresh')?.getAttribute('data-tone')).toBe('none');
  });
});
