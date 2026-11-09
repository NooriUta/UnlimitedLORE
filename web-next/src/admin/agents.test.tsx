// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-15, S7B-16 — агенты: harness и машина в админке v2.
// Форма ответа — от сервера (d8097ab4, миграция V75): agent_owners + harness,
// реестр harness_registry, правка POST /lore/actor/owner (harness "" — сброс).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AgentsScreen } from './AgentsScreen';
import { filterAgents, harnessCounts, HARNESS_NONE, parseAgents, setAgentHarness } from './agents';

beforeAll(() => { registerGameIcons(gameIcons); });

const REG = ['claude-code', 'kimi-code', 'dsh', 'codex', 'opencode'];
const ROWS = [
  { actor_id: 'A1', name: 'Claude Code (full)', client_id: 'lore-full', agent_role: 'full', machine_id: 'lorcetus', session_id: null, harness: 'claude-code', owner_kc_sub: 'u1', owner_display_name: 'Владелица' },
  { actor_id: 'A2', name: 'Kimi', client_id: 'lore-full', agent_role: 'full', machine_id: null, session_id: null, harness: 'kimi-code', owner_kc_sub: 'u1', owner_display_name: 'Владелица' },
  { actor_id: 'A3', name: 'Непонятный', client_id: 'lore-ro', agent_role: 'reader', machine_id: null, session_id: null, harness: null, owner_kc_sub: null, owner_display_name: null },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fake(body: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith('/lore/actor/owner')) return json({ ok: true });
    return json(body, status);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={f} /></KitLangProvider>);

describe('модель агентов', () => {
  it('harness и машина читаются; пустая строка — null, а не «»', () => {
    const d = parseAgents({ rows: [{ ...ROWS[0], machine_id: '' }], harness_registry: REG } as never);
    expect(d.rows[0].harness).toBe('claude-code');
    expect(d.rows[0].machine_id).toBeNull();
    expect(d.registry).toEqual(REG);
  });

  it('реестра нет в ответе — registry null (правку не предлагаем), а не пустой список', () => {
    expect(parseAgents({ rows: ROWS } as never).registry).toBeNull();
  });

  it('разбивка: каждый harness реестра, «не указан» отдельно; пустые harness реестра — с нулём', () => {
    const c = harnessCounts(parseAgents({ rows: ROWS, harness_registry: REG } as never).rows, REG);
    expect(c.find(x => x.key === 'claude-code')?.n).toBe(1);
    expect(c.find(x => x.key === 'dsh')?.n).toBe(0);
    expect(c.find(x => x.key === HARNESS_NONE)?.n).toBe(1);
  });

  it('фильтр «не указан» отбирает агентов без harness', () => {
    const rows = parseAgents({ rows: ROWS } as never).rows;
    expect(filterAgents(rows, HARNESS_NONE).map(r => r.actor_id)).toEqual(['A3']);
    expect(filterAgents(rows, null)).toHaveLength(3);
  });

  it('правка: тело по договору с сервером; сброс — harness ""', async () => {
    const { f, calls } = fake({});
    await setAgentHarness({ actor_id: 'A3', client_id: 'lore-ro', owner_kc_sub: null }, null, f);
    expect(calls[0].url).toBe('/lore/actor/owner');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ actor_id: 'A3', client_id: 'lore-ro', kc_sub: null, harness: '' });
  });

  it('400 вне реестра — ошибка со статусом, не молчаливый успех', async () => {
    const f = vi.fn(async () => json({ error: 'BAD_HARNESS', detail: 'допустимо: claude-code, …' }, 400)) as unknown as typeof fetch;
    await expect(setAgentHarness({ actor_id: 'A1', client_id: null, owner_kc_sub: null }, 'x', f)).rejects.toMatchObject({ status: 400 });
  });
});

describe('экран «Агенты»', () => {
  it('сводка чипами: сколько агентов какого harness; «не указан» видно отдельно', async () => {
    mount(fake({ rows: ROWS, harness_registry: REG }).f);
    const chips = await screen.findByTestId('adm-harness-chips');
    expect(within(chips).getByTestId('adm-harness-claude-code').textContent).toContain('1');
    expect(within(chips).getByTestId(`adm-harness-${HARNESS_NONE}`).textContent).toMatch(/не указан.*1/);
  });

  it('у агента без машины — «не привязана» словами, а не пустая клетка', async () => {
    mount(fake({ rows: ROWS, harness_registry: REG }).f);
    const row = await screen.findByTestId('adm-agent-A2');
    expect(row.textContent).toContain('не привязана');
    expect((await screen.findByTestId('adm-agent-A1')).textContent).toContain('lorcetus');
  });

  it('чип фильтрует таблицу; повторное нажатие снимает', async () => {
    mount(fake({ rows: ROWS, harness_registry: REG }).f);
    fireEvent.click(await screen.findByTestId('adm-harness-kimi-code'));
    expect(screen.queryByTestId('adm-agent-A1')).toBeNull();
    expect(screen.getByTestId('adm-agent-A2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('adm-harness-kimi-code'));
    expect(screen.getByTestId('adm-agent-A1')).toBeTruthy();
  });

  it('выбор harness из реестра сохраняется на сервер и список перечитывается', async () => {
    const { f, calls } = fake({ rows: ROWS, harness_registry: REG });
    mount(f);
    const sel = within(await screen.findByTestId('adm-agent-A3')).getByRole('combobox');
    fireEvent.change(sel, { target: { value: 'dsh' } });
    await waitFor(() => expect(calls.some(c => c.url === '/lore/actor/owner')).toBe(true));
    const post = calls.find(c => c.url === '/lore/actor/owner')!;
    expect(JSON.parse(String(post.init?.body)).harness).toBe('dsh');
    await waitFor(() => expect(calls.filter(c => c.url.startsWith('/lore/slice/agent_owners')).length).toBe(2));
  });

  it('сервер без реестра: правки нет, harness показан как есть, причина сказана', async () => {
    mount(fake({ rows: ROWS }).f);
    expect(await screen.findByTestId('adm-no-registry')).toBeTruthy();
    expect(within(screen.getByTestId('adm-agent-A1')).queryByRole('combobox')).toBeNull();
  });

  it('403 — «нет прав», а не «агентов нет»', async () => {
    mount(fake({ error: 'FORBIDDEN', detail: 'admin only' }, 403).f);
    await waitFor(() => expect(document.body.textContent).toMatch(/прав/i));
    expect(document.body.textContent).not.toContain('Агентов нет');
  });
});
