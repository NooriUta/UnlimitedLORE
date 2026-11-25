// @vitest-environment jsdom
// SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE — личная страница человека и карточка агента вне админки по прототипу
// docs/prototypes/ap-people-page.html, согласованному владелицей 21.11.2026 («ок согласовано»).
//  • карточка агента: значок harness, имя, профиль, машина (если известна), «чей он» — владелец ссылкой на его
//    личную страницу; владельца нет — «владелец не указан»; учётки (client_id) нет ни текстом, ни подсказкой;
//  • страница человека: вкладка «Лента» — новости с фильтром по автору (ось who, S7A-12) и «Аналитика» — графики
//    по его задачам (user_tasks, task_done_dates).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons, type KitConfig } from '@seidr/kit';
import { AgentHeadLine } from './AgentHeadLine';
import { USER_FEED_TAB, withUserFeedTab } from './userFeedTab';
import { passportCharts } from './ListPassport';
import { UserCharts } from '../charts/UserCharts';
import { userProjectBars, userStatusBars } from '../charts/userModel';
import { NEWS_FIXTURE, type NewsSource } from '../news/feed';
import ru from '../i18n/ru.json';
import en from '../i18n/en.json';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/?sec=agent&open=AGENT-FULL-x&pch=1'); });

const wrap = (n: React.ReactNode) => render(<KitLangProvider lang="ru">{n}</KitLangProvider>);
const NOW = Date.parse('2026-11-25T12:00:00Z');

const harnessDict = { rows: [{ code: 'claude', label_ru: 'Claude Code', label_en: 'Claude Code', icon: 'simple-icons:claudecode', active: true, sort: 1 }] };

describe('карточка агента вне админки', () => {
  it('значок, имя harness, профиль, машина и «чей он» — ссылкой на личную страницу владельца', async () => {
    const asked: string[] = [];
    wrap(<AgentHeadLine
      values={{ title: 'Claude Code (full)', agent_role: 'full', harness: 'claude', owner: 'sub-ann', client_id: 'lore-mcp-full' }}
      links={[{ rel: 'USES_MACHINE', dir: 'out', id: 'LEGION', type: 'machine', title: 'LEGION', status: '' }]}
      load={async (s, p) => {
        asked.push(`${s}:${JSON.stringify(p)}`);
        if (s === 'dictionary') return harnessDict;
        return { rows: [{ kc_sub: 'sub-ann', display_name: 'Ann So', login: 'annso' }] };
      }} />);
    const who = screen.getByTestId('agent-who');
    await waitFor(() => expect(who.textContent).toContain('Claude Code'));
    expect(who.textContent).toContain('full');
    expect(who.textContent).toContain('LEGION');
    expect(document.querySelector('[data-testid="adm-harness-mark"]')).toBeTruthy();
    const owner = await screen.findByTestId('agent-owner-link');
    expect(owner.textContent).toContain('Ann So');
    expect(screen.getByTestId('agent-owner').textContent).toContain('annso');
    // Личная страница вне админки, не /admin.
    expect(owner.getAttribute('href')).toContain('sec=user');
    expect(owner.getAttribute('href')).toContain('open=sub-ann');
    expect(owner.getAttribute('href')).not.toContain('admin');
    // Учётка не уходит ни текстом, ни подсказкой — даже если сервер старше и прислал её.
    expect(document.body.innerHTML).not.toContain('lore-mcp-full');
    expect(asked.some(a => a.startsWith('user_by_id:') && a.includes('sub-ann'))).toBe(true);
  });

  it('владельца нет — «владелец не указан», а не пусто; машины нет — без третьей части', async () => {
    wrap(<AgentHeadLine values={{ agent_role: 'tester', harness: 'claude' }} links={[]} load={async () => harnessDict} />);
    expect((await screen.findByTestId('agent-owner-none')).textContent).toBe(ru['agentHead.noOwner']);
    await waitFor(() => expect(screen.getByTestId('agent-who').textContent).toBe('Claude Code · tester'));
  });

  it('владельца не смогли прочитать — так и сказано, это не «не указан»', async () => {
    wrap(<AgentHeadLine values={{ agent_role: 'full', harness: 'claude', owner: 'sub-x' }} links={[]}
      load={async s => { if (s === 'dictionary') return harnessDict; throw new Error('502 LORE_UPSTREAM'); }} />);
    const err = await screen.findByTestId('agent-owner-error');
    expect(err.textContent).toContain('502 LORE_UPSTREAM');
    expect(screen.queryByTestId('agent-owner-none')).toBeNull();
  });

  it('справочник harness не прочитан — код словом, без самодельного значка', async () => {
    wrap(<AgentHeadLine values={{ agent_role: 'full', harness: 'kimi' }} links={[]} load={async () => { throw new Error('нет'); }} />);
    await waitFor(() => expect(screen.getByTestId('agent-who').textContent).toBe('kimi · full'));
    expect(document.querySelector('[data-testid="adm-harness-mark"]')).toBeNull();
  });
});

describe('страница человека: «Лента» — новости с фильтром по автору', () => {
  const cfg = { kinds: { user: { tabs: [{ key: 'tasks', title: 'Задачи' }] } } } as unknown as KitConfig;

  it('вкладка добавляется только человеку и только с ключом', () => {
    const next = withUserFeedTab(cfg, 'user', 'Лента', 'sub-ann');
    expect(next.kinds.user.tabs?.map(t => t.key)).toEqual(['tasks', USER_FEED_TAB]);
    expect(withUserFeedTab(cfg, 'user', 'Лента', null)).toBe(cfg);
    expect(withUserFeedTab(cfg, 'agent', 'Лента', 'x')).toBe(cfg);
  });

  it('лента зовёт /lore/news/v2 с who = kc_sub человека — тот же фильтр, что в «Новостях»', async () => {
    const seen: string[] = [];
    const source: NewsSource = { kind: 'live', load: async p => { seen.push(p.toString()); return NEWS_FIXTURE; }, setReadMark: async () => ({ state: 'ok', at: null }) };
    const next = withUserFeedTab(cfg, 'user', 'Лента', 'sub-ann', source);
    const tab = next.kinds.user.tabs!.find(t => t.key === USER_FEED_TAB)!;
    wrap(<>{tab.render!({ id: 'sub-ann', title: 'Ann So' } as never)}</>);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(new URLSearchParams(seen[0]).get('who')).toBe('sub-ann');
  });
});

describe('страница человека: «Аналитика» — графики по его задачам', () => {
  it('статусы корзинами жизненного цикла, проекты — пять крупных и «прочие»', () => {
    const rows = [
      { status_raw: '🔄 IN PROGRESS', project: 'A' }, { status_raw: 'active', project: 'A' },
      { status_raw: '🧪 UAT', project: 'B' }, { status_raw: '🚀 READY FOR DEPLOY', project: 'C' },
      { status_raw: '✅ DONE', project: 'D' }, { status_raw: 'waiting', project: 'E' }, { status_raw: '⬜ TODO', project: 'F' },
      { status_raw: null, project: null },
    ];
    const st = Object.fromEntries(userStatusBars(rows).map(b => [b.category, b.values.t]));
    expect(st).toMatchObject({ work: 2, review: 2, waiting: 1, done: 1, todo: 1 });
    const pr = userProjectBars(rows, 5);
    expect(pr[0]).toEqual({ category: 'A', values: { t: 2 } });
    expect(pr.find(b => b.category === 'other')).toEqual({ category: 'other', values: { t: 2 } });
    expect(pr).toHaveLength(6);
  });

  it('паспорт человека получает графики; закрытое считается только по его задачам', async () => {
    expect(passportCharts('user', 'sub-ann')).toBeTruthy();
    const asked: string[] = [];
    wrap(<UserCharts kcSub="sub-ann" now={NOW} narrow={false} load={async (s, p) => {
      asked.push(`${s}:${p.kc_sub ?? ''}`);
      if (s === 'user_tasks') return { rows: [{ task_uid: 'S/A', status_raw: '✅ DONE', project: 'P' }, { task_uid: 'S/B', status_raw: 'active', project: 'P' }] };
      return { rows: [{ task_uid: 'S/A', valid_from: '2026-11-20T10:00:00Z' }, { task_uid: 'S/OTHER', valid_from: '2026-11-20T10:00:00Z' }] };
    }} />);
    await waitFor(() => expect(document.querySelectorAll('[data-testid="kit-chart"]').length).toBe(3));
    expect(asked.sort()).toEqual(['task_done_dates:', 'user_tasks:sub-ann']);
    expect(screen.getByTestId('user-charts').getAttribute('data-closed')).toBe('1');
  });

  it('срез не прочитан — причина словами, а не пустые графики', async () => {
    wrap(<UserCharts kcSub="sub-ann" now={NOW} narrow={false} load={async () => { throw new Error('502 упало'); }} />);
    await waitFor(() => expect(document.body.textContent).toContain('502 упало'));
  });
});

describe('i18n: новые ключи — в обеих локалях', () => {
  it('agentHead.* и userCharts.* есть в ru и en', () => {
    const keys = Object.keys(ru).filter(k => k.startsWith('agentHead.') || k.startsWith('userCharts.') || k === 'userFeed.tab' || k === 'charts.hint.user');
    expect(keys.length).toBeGreaterThan(8);
    for (const k of keys) expect((en as Record<string, string>)[k], k).toBeTruthy();
  });
});
