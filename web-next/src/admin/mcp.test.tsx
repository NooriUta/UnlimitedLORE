// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-07 — раздел MCP в админке v2: подключения и сбои по ПРОФИЛЯМ.
//
// Сервер (LoreSlices, PR #961):
//   • mcp_connections → rows[{caller, calls, last_seen (epoch millis)}] — профиль
//     агента (agent_scope: full, pm, …), а не сессия: сессии одного клиента KC
//     неразличимы (решение владелицы 10.11 — экран про профили);
//   • mcp_failures → rows[{caller, failures, last_failure}] — записи агента с кодом ≥ 400.
// Профиля, который ни разу не звал, в срезе нет — это «не видели», а не «здоров».
//
// Проверяем ПРАВИЛА честности:
//   • давно молчащий профиль помечен «не видели» (а не «здоров»);
//   • сбои есть, а вызовов не видели — так и сказано;
//   • срез сбоев не прочитался — подключения видны, про сбои сказано «не смогли»;
//   • ноль подключений — «вызовов не видели», а не «всё в порядке»;
//   • 403 — «нет прав», а не пустой список;
//   • фильтр «только молчащие» — в адресе.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { McpScreen } from './McpScreen';
import { mergeMcp, MCP_STALE_MS } from './mcp';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const HOUR = 3_600_000;
const CONN = [
  { caller: 'full', calls: 2618, last_seen: NOW - 5 * 60_000 },
  { caller: 'pm', calls: 40, last_seen: NOW - 3 * 24 * HOUR },
];
const FAIL = [
  { caller: 'full', failures: 7, last_failure: NOW - HOUR },
  { caller: 'tester', failures: 2, last_failure: NOW - 2 * HOUR },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fake(o: { conn?: unknown; connStatus?: number; fail?: unknown; failStatus?: number } = {}) {
  const f = vi.fn(async (url: string) => {
    if (url.startsWith('/lore/slice/mcp_connections')) return json(o.conn ?? { rows: CONN }, o.connStatus ?? 200);
    if (url.startsWith('/lore/slice/mcp_failures')) return json(o.fail ?? { rows: FAIL }, o.failStatus ?? 200);
    return json({ error: 'NOPE' }, 404);
  }) as unknown as typeof fetch;
  return f;
}

const mount = (f: typeof fetch) =>
  render(<KitLangProvider lang="ru"><McpScreen fetchImpl={f} now={NOW} /></KitLangProvider>);

describe('модель MCP-профилей', () => {
  it('подключения и сбои сведены по профилю; порядок — свежие сверху', () => {
    const rows = mergeMcp(CONN, FAIL, NOW);
    expect(rows.map(r => r.caller)).toEqual(['full', 'pm', 'tester']);
    expect(rows[0]).toMatchObject({ calls: 2618, failures: 7, health: 'live' });
  });

  // SPRINT_UXR_POLISH_UAT_1113/PU-04: срез отдаёт last_seen/last_failure из TIMESERIES
  // ISO-строкой; читать их числом = «вызовов не видели» при 31 512 вызовах.
  it('last_seen/last_failure ISO-строкой — профиль live, моменты числом', () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    const rows = mergeMcp(
      [{ caller: 'full', calls: 31512, last_seen: iso(NOW - 5 * 60_000) }],
      [{ caller: 'full', failures: 208, last_failure: iso(NOW - HOUR) }],
      NOW);
    expect(rows[0]).toMatchObject({ health: 'live', lastSeen: NOW - 5 * 60_000, lastFailure: NOW - HOUR });
  });

  it('молчит дольше порога — «не видели» (stale), а не «здоров»', () => {
    const rows = mergeMcp(CONN, [], NOW);
    expect(rows.find(r => r.caller === 'pm')?.health).toBe('stale');
    expect(MCP_STALE_MS).toBe(24 * HOUR);
  });

  it('сбои есть, вызовов не видели — unseen, calls null (не ноль)', () => {
    const t = mergeMcp(CONN, FAIL, NOW).find(r => r.caller === 'tester')!;
    expect(t.health).toBe('unseen');
    expect(t.calls).toBeNull();
    expect(t.lastSeen).toBeNull();
  });

  it('срез сбоев не прочитан — failures null у всех, а не 0', () => {
    const rows = mergeMcp(CONN, null, NOW);
    expect(rows.every(r => r.failures === null)).toBe(true);
  });
});

describe('экран MCP', () => {
  it('у профиля — вызовы, последний раз, сбои; молчащий помечен «не видели»', async () => {
    mount(fake());
    const table = await screen.findByTestId('adm-mcp');
    const full = within(table).getByTestId('adm-mcp-full');
    expect(full.getAttribute('data-health')).toBe('live');
    expect(full.textContent).toContain('2618');
    expect(full.textContent).toContain('7');
    const pm = within(table).getByTestId('adm-mcp-pm');
    expect(pm.getAttribute('data-health')).toBe('stale');
    expect(pm.textContent).toMatch(/не видели/i);
    expect(within(table).getByTestId('adm-mcp-tester').getAttribute('data-health')).toBe('unseen');
  });

  it('экран говорит, что это профили, а не сессии', async () => {
    mount(fake());
    await screen.findByTestId('adm-mcp');
    expect(screen.getByTestId('adm-mcp-profiles-note').textContent).toMatch(/сесси/i);
  });

  it('сбои не прочитались — подключения видны, про сбои сказано «не смогли»', async () => {
    mount(fake({ fail: { error: 'DOWN' }, failStatus: 502 }));
    await screen.findByTestId('adm-mcp');
    expect(screen.getByTestId('adm-mcp-fail-error').textContent).toMatch(/не смогли/i);
    expect(within(screen.getByTestId('adm-mcp-full')).getByTestId('adm-mcp-failures').getAttribute('data-state')).toBe('unknown');
  });

  it('ноль подключений и сбоев — «вызовов агентов не видели», а не «всё в порядке»', async () => {
    mount(fake({ conn: { rows: [] }, fail: { rows: [] } }));
    const empty = await screen.findByTestId('adm-mcp-empty');
    expect(empty.textContent).toMatch(/не видели/i);
    // S7B-25: kit EmptyState (его значок), а не своя разметка.
    expect(empty.querySelector('.sk-state__icon')).toBeTruthy();
  });

  it('403 — «нет прав», а не пустой список', async () => {
    mount(fake({ conn: { error: 'FORBIDDEN', detail: 'admin only' }, connStatus: 403 }));
    expect(await screen.findByText(/admin only/)).toBeTruthy();
    expect(screen.queryByTestId('adm-mcp-empty')).toBeNull();
  });

  it('фильтр «только молчащие» — в адресе и сужает таблицу', async () => {
    mount(fake());
    await screen.findByTestId('adm-mcp');
    fireEvent.click(screen.getByTestId('adm-mcp-only-silent'));
    await waitFor(() => expect(window.location.search).toContain('adm-mcp-f=silent'));
    await waitFor(() => expect(within(screen.getByTestId('adm-mcp')).queryByTestId('adm-mcp-full')).toBeNull());
    expect(within(screen.getByTestId('adm-mcp')).getByTestId('adm-mcp-pm')).toBeTruthy();
    expect(within(screen.getByTestId('adm-mcp')).getByTestId('adm-mcp-tester')).toBeTruthy();
  });
});
