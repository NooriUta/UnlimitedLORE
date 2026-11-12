// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-22 — у агента рядом с именем и машиной маленький
// ОФИЦИАЛЬНЫЙ знак harness. Знак — атрибут записи справочника harness (поле
// icon), а не таблица в клиенте. Официальным считается только логотип
// производителя из вшитого набора (simple-icons, у каждого — источник);
// глиф game-icons/lucide (как нынешний засев robot-golem) — самодельный знак,
// его НЕ рисуем. Знака нет — показываем текст, общий значок не подставляем.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, hasGameIcon, registerGameIcons } from '@seidr/kit';
import { AgentsScreen } from './AgentsScreen';
import { parseAgents, parseHarnessDict, type AgentRow } from './agents';
import { HARNESS_LOGOS, HARNESS_LOGO_SOURCES, harnessLogo } from './harnessLogos';
import { AgentChip, HarnessMark, callerHarness, harnessValueIcon } from './HarnessMark';

beforeAll(() => { registerGameIcons(gameIcons); });

const DICT = [
  { code: 'claude-code', label_ru: 'Claude Code', label_en: 'Claude Code', sort_order: 10, is_active: true, icon: 'simple-icons:claudecode' },
  { code: 'kimi-code', label_ru: 'Kimi Code', label_en: 'Kimi Code', sort_order: 20, is_active: true, icon: 'simple-icons:kimi' },
  // Нынешний засев прода: глиф game-icons — самодельный знак, не логотип.
  { code: 'dsh', label_ru: 'dsh', label_en: 'dsh', sort_order: 30, is_active: true, icon: 'robot-golem' },
  { code: 'codex', label_ru: 'Codex', label_en: 'Codex', sort_order: 40, is_active: true, icon: null },
];
const ROWS = [
  { actor_id: 'A1', name: 'Claude Code (full)', client_id: 'lore-full', agent_role: 'full', machine_id: 'lorcetus', harness: 'claude-code', owner_kc_sub: ['u1'], owner_display_name: ['Владелица'] },
  { actor_id: 'A2', name: 'Kimi', client_id: 'lore-kimi', agent_role: 'full', machine_id: null, harness: 'kimi-code', owner_kc_sub: ['u1'], owner_display_name: ['Владелица'] },
  { actor_id: 'A3', name: 'DSH', client_id: 'lore-dsh', agent_role: 'reader', machine_id: null, harness: 'dsh', owner_kc_sub: ['u1'], owner_display_name: ['Владелица'] },
  { actor_id: 'A4', name: 'Без harness', client_id: 'lore-ro', agent_role: 'reader', machine_id: null, harness: null, owner_kc_sub: ['u1'], owner_display_name: ['Владелица'] },
  { actor_id: 'A5', name: 'Второй full', client_id: 'lore-full', agent_role: 'full', machine_id: null, harness: 'dsh', owner_kc_sub: ['u1'], owner_display_name: ['Владелица'] },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('вшитый набор официальных логотипов', () => {
  it('каждый логотип зарегистрирован под «simple-icons:имя» и имеет источник производителя', () => {
    const names = Object.keys(HARNESS_LOGOS.icons);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(hasGameIcon(`simple-icons:${n}`), n).toBe(true);
      expect(HARNESS_LOGO_SOURCES[n]?.source, n).toMatch(/^https:\/\//);
    }
  });
  it('harnessLogo: логотип из набора — да; глиф game-icons, неизвестный логотип, пусто — нет', () => {
    expect(harnessLogo('simple-icons:claudecode')).toBe('simple-icons:claudecode');
    expect(harnessLogo('robot-golem')).toBeNull();
    expect(harnessLogo('lucide:star')).toBeNull();
    expect(harnessLogo('simple-icons:nope')).toBeNull();
    expect(harnessLogo(null)).toBeNull();
    expect(harnessLogo('')).toBeNull();
  });
});

describe('модель: знак — из справочника', () => {
  it('у строки агента — логотип и подпись harness из справочника; самодельный глиф и пусто — null', () => {
    const d = parseAgents({ rows: ROWS } as never, parseHarnessDict(DICT));
    const by = Object.fromEntries(d.rows.map(r => [r.actor_id, r]));
    expect(by.A1.harness_logo).toBe('simple-icons:claudecode');
    expect(by.A1.harness_label).toBe('Claude Code');
    expect(by.A2.harness_logo).toBe('simple-icons:kimi');
    expect(by.A3.harness_logo).toBeNull();
    expect(by.A3.harness_label).toBe('dsh');
    expect(by.A4.harness_logo).toBeNull();
    expect(by.A4.harness_label).toBeNull();
    expect(d.logos).toEqual({ 'claude-code': 'simple-icons:claudecode', 'kimi-code': 'simple-icons:kimi' });
  });
  it('справочник не прочитан — знаков нет (не угадываем по коду)', () => {
    const d = parseAgents({ rows: ROWS } as never, { error: 'HTTP 502' });
    expect(d.rows.every(r => r.harness_logo === null)).toBe(true);
    expect(d.logos).toEqual({});
  });
});

describe('HarnessMark / AgentChip', () => {
  it('логотип — маленький svg с подписью harness', () => {
    render(<HarnessMark logo="simple-icons:claudecode" label="Claude Code" />);
    const m = screen.getByTestId('adm-harness-mark');
    expect(m.querySelector('svg')).not.toBeNull();
    expect(m.getAttribute('title')).toBe('Claude Code');
    expect(screen.getByRole('img', { name: 'Claude Code' })).toBeTruthy();
  });
  it('нет логотипа — ничего не рисуется (никакого общего значка)', () => {
    const { container } = render(<HarnessMark logo={null} label="dsh" />);
    expect(container.innerHTML).toBe('');
  });
  it('AgentChip: имя + знак; без знака — только имя', () => {
    const d = parseAgents({ rows: ROWS } as never, parseHarnessDict(DICT));
    const a1 = d.rows.find(r => r.actor_id === 'A1') as AgentRow;
    const a3 = d.rows.find(r => r.actor_id === 'A3') as AgentRow;
    const { rerender } = render(<AgentChip row={a1} />);
    expect(screen.getByText('Claude Code (full)')).toBeTruthy();
    expect(screen.getByTestId('adm-harness-mark')).toBeTruthy();
    rerender(<AgentChip row={a3} />);
    expect(screen.getByText('DSH')).toBeTruthy();
    expect(screen.queryByTestId('adm-harness-mark')).toBeNull();
  });
});

describe('журнал и «Доступ к машинам»', () => {
  const d = parseAgents({ rows: ROWS } as never, parseHarnessDict(DICT));
  it('caller журнала → знак, только если все агенты этой учётки одного harness', () => {
    expect(callerHarness('lore-kimi', d.rows)).toEqual({ logo: 'simple-icons:kimi', label: 'Kimi Code' });
    // lore-full — у двух агентов разные harness: знак был бы угадкой.
    expect(callerHarness('lore-full', d.rows)).toBeNull();
    expect(callerHarness('A1', d.rows)).toEqual({ logo: 'simple-icons:claudecode', label: 'Claude Code' });
    expect(callerHarness('lore-dsh', d.rows)).toBeNull();
    expect(callerHarness('nobody', d.rows)).toBeNull();
    expect(callerHarness(null, d.rows)).toBeNull();
  });
  it('в журнале агент записан ПРОФИЛЕМ (caller = agent_scope) — знак по агентам этого профиля, если harness у них один', () => {
    const kimiOnly = d.rows.filter(r => r.actor_id === 'A2');
    expect(callerHarness('full', kimiOnly)).toEqual({ logo: 'simple-icons:kimi', label: 'Kimi Code' });
    // full у трёх агентов разных harness — знак был бы угадкой.
    expect(callerHarness('full', d.rows)).toBeNull();
  });
  it('значение harness в списке машин (подписью) → логотип; без логотипа — null; чужое поле — kit решает', () => {
    const vi_ = harnessValueIcon(d.labels, d.logos);
    expect(vi_('harness', 'Claude Code')).toEqual({ icon: 'simple-icons:claudecode' });
    expect(vi_('fields.harness', 'Kimi Code')).toEqual({ icon: 'simple-icons:kimi' });
    expect(vi_('harness', 'dsh')).toBeNull();
    expect(vi_('owner', 'Claude Code')).toBeUndefined();
  });
});

describe('экран «Агенты»: знак рядом с именем', () => {
  it('у агента с логотипом — знак в строке; у самодельного глифа и без harness — нет', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.startsWith('/lore/slice/dictionary')) return json({ rows: DICT });
      return json({ rows: ROWS });
    }) as unknown as typeof fetch;
    render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={f} /></KitLangProvider>);
    await waitFor(() => expect(screen.getByTestId('adm-agent-A1')).toBeTruthy());
    const nameCell = (id: string) => within(screen.getByTestId(`adm-agent-${id}`)).getByRole('rowheader');
    expect(within(nameCell('A1')).getByTestId('adm-harness-mark').getAttribute('data-logo')).toBe('simple-icons:claudecode');
    expect(within(nameCell('A2')).getByTestId('adm-harness-mark')).toBeTruthy();
    expect(within(nameCell('A3')).queryByTestId('adm-harness-mark')).toBeNull();
    expect(within(nameCell('A4')).queryByTestId('adm-harness-mark')).toBeNull();
    // Чип-фильтр по harness — со знаком у того, у кого он есть.
    expect(within(screen.getByTestId('adm-harness-claude-code')).getByTestId('adm-harness-mark')).toBeTruthy();
    expect(within(screen.getByTestId('adm-harness-dsh')).queryByTestId('adm-harness-mark')).toBeNull();
  });
});
