// @vitest-environment jsdom
// SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.2) — «гирлянда»: вкладка «Учётки harness» на экране Агентов.
//
// Правила:
//   • дерево «главная роль → младшие» по порядку модели (сервер присылает level);
//   • у узла — выпущена ли учётка (имя клиента KC, включена, когда сменён секрет, «перешёл?»);
//   • «Выпустить» для роли выше главной недоступна, подсказка — словами сервера (refusal);
//   • KC не настроен / недоступен ≠ учётки нет ≠ пусто;
//   • выпуск: секрет — один раз (SecretOnce), рядом ключ секрета и итог записи в Infisical;
//   • вкладка, harness и выбранная роль — в адресе.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { HarnessAccountsPane } from './HarnessAccountsPane';
import { parseHarnessAccounts, parseInfisical } from './harnessAccounts';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => {
  window.history.replaceState(null, '', '/?mod=admin&sec=adm-agents&adm-agents-tab=accounts');
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* нет хранилища */ }
});

const SECRET = 'iss-u3d-s3cr3t-77';
const REFUSAL = 'главная учётка harness «kimi-code» — роль «pm», а «full» выше неё или ей не подчинена';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function tree(kc: Record<string, unknown> = { state: 'checked' }, testerAccount: Record<string, unknown> = { state: 'absent' }) {
  const unknown = kc.state === 'checked' ? null : { state: 'unknown', reason: kc.reason };
  return {
    harness: 'kimi-code', main: 'pm', suffix: 'kimi', kc, infisical: 'configured',
    nodes: [
      { role: 'full', level: 0, is_main: false, client_id: 'lore-mcp-full_kimi', secret_key: 'LORE_MCP_CLIENT_SECRET_FULL_KIMI',
        issuable: false, refusal: REFUSAL, account: unknown ?? { state: 'absent' } },
      { role: 'pm', level: 1, is_main: true, client_id: 'lore-mcp-pm_kimi', secret_key: 'LORE_MCP_CLIENT_SECRET_PM_KIMI',
        issuable: true, refusal: null, account: unknown ?? { state: 'issued', id: 'u1', enabled: true,
          secret_created_at: '2026-11-20T10:00:00Z', rotated_at: '2026-11-21T08:00:00Z', old_secret_active: true,
          switched: { seen: true, at: '2026-11-21T08:30:00Z' } } },
      { role: 'tester', level: 2, is_main: false, client_id: 'lore-mcp-tester_kimi', secret_key: 'LORE_MCP_CLIENT_SECRET_TESTER_KIMI',
        issuable: true, refusal: null, account: unknown ?? testerAccount },
    ],
  };
}

function fake(accounts: () => Response, issue?: () => Response) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === '/lore/kc/harness') return json({ harness: [{ code: 'claude-code', main: 'full', suffix: '' }, { code: 'kimi-code', main: 'pm', suffix: 'kimi' }] });
    if (url === '/lore/kc/harness/kimi-code/accounts') return accounts();
    if (url === '/lore/kc/harness/claude-code/accounts') return json({ ...tree(), harness: 'claude-code', main: 'full' });
    if (url === '/lore/kc/agent-client' && issue) return issue();
    if (url.endsWith('/disable') || url.endsWith('/enable')) return json({ ok: true });
    return json({ error: 'NOT_FOUND' }, 404);
  });
  return { f: f as unknown as typeof fetch, calls };
}

function mount(f: typeof fetch) {
  return render(<KitLangProvider lang="ru"><HarnessAccountsPane fetchImpl={f} /></KitLangProvider>);
}

describe('parse', () => {
  it('незнакомое состояние учётки — «не смогли проверить», а не «нет учётки»', () => {
    const d = parseHarnessAccounts({ ...tree(), nodes: [{ role: 'x', client_id: 'lore-mcp-x', account: { state: 'weird' } }] });
    expect(d.nodes[0].account.state).toBe('unknown');
  });
  it('итог Infisical: сервер не сказал — null', () => {
    expect(parseInfisical({})).toBeNull();
    expect(parseInfisical({ infisical_written: false, infisical_state: 'not_configured', infisical_reason: 'r' }))
      .toEqual({ written: false, state: 'not_configured', reason: 'r' });
  });
});

describe('HarnessAccountsPane', () => {
  it('дерево по порядку модели, главная роль помечена, уровни — aria-level', async () => {
    window.history.replaceState(null, '', '/?adm-harness=kimi-code');
    const { f } = fake(() => json(tree()));
    mount(f);
    const items = await screen.findAllByRole('treeitem');
    expect(items.map(i => i.getAttribute('data-role'))).toEqual(['full', 'pm', 'tester']);
    expect(items.map(i => i.getAttribute('aria-level'))).toEqual(['1', '2', '3']);
    expect(within(items[1]).getByTestId('adm-hacc-main')).toBeTruthy();
    expect(within(items[1]).getByText('lore-mcp-pm_kimi')).toBeTruthy();
    expect(items[1].getAttribute('data-account')).toBe('issued');
    expect(items[2].getAttribute('data-account')).toBe('absent');
  });

  it('роль выше главной: «Выпустить» недоступна, причина — словами сервера', async () => {
    window.history.replaceState(null, '', '/?adm-harness=kimi-code&adm-acc=full');
    const { f } = fake(() => json(tree()));
    mount(f);
    const btn = await screen.findByTestId('adm-hacc-issue');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('adm-hacc-refusal').textContent).toContain(REFUSAL);
  });

  it('KC не настроен — «не смогли проверить» с причиной, а не «учёток нет»', async () => {
    window.history.replaceState(null, '', '/?adm-harness=kimi-code');
    const { f } = fake(() => json(tree({ state: 'not_configured', reason: 'мост Keycloak не настроен: нет [KC_ADMIN_CLIENT_SECRET]' })));
    mount(f);
    expect((await screen.findByTestId('adm-hacc-kc')).textContent).toContain('KC_ADMIN_CLIENT_SECRET');
    const items = screen.getAllByRole('treeitem');
    expect(items.every(i => i.getAttribute('data-account') === 'unknown')).toBe(true);
    expect(screen.queryByText(/не выпущена/)).toBeNull();
  });

  it('срез не загрузился — ошибка, а не пустое дерево', async () => {
    window.history.replaceState(null, '', '/?adm-harness=kimi-code');
    const { f } = fake(() => json({ error: 'KC_UPSTREAM', detail: 'boom' }, 502));
    mount(f);
    await waitFor(() => expect(screen.queryAllByRole('treeitem')).toHaveLength(0));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('выбор harness и роли — в адресе', async () => {
    const { f } = fake(() => json(tree()));
    mount(f);
    fireEvent.click(await screen.findByTestId('adm-hacc-h-kimi-code'));
    expect(new URLSearchParams(window.location.search).get('adm-harness')).toBe('kimi-code');
    const items = await screen.findAllByRole('treeitem');
    fireEvent.click(within(items[2]).getByTestId('adm-hacc-select'));
    expect(new URLSearchParams(window.location.search).get('adm-acc')).toBe('tester');
  });

  it('выпуск: секрет один раз, ключ секрета и итог Infisical; секрета нет ни в адресе, ни в хранилище', async () => {
    window.history.replaceState(null, '', '/?adm-harness=kimi-code&adm-acc=tester');
    const { f, calls } = fake(() => json(tree()), () => json({ ok: true, clientId: 'lore-mcp-tester_kimi', secret: SECRET,
      secret_key: 'LORE_MCP_CLIENT_SECRET_TESTER_KIMI', infisical_written: false, infisical_state: 'failed',
      infisical_reason: 'вход машинной учётки в Infisical не принят: HTTP 401' }));
    mount(f);
    fireEvent.click(await screen.findByTestId('adm-hacc-issue'));
    expect(await screen.findByTestId('adm-hacc-infisical')).toBeTruthy();
    expect(screen.getByTestId('adm-hacc-infisical').getAttribute('data-tone')).toBe('dng');
    expect(screen.getByTestId('adm-hacc-infisical').textContent).toContain('HTTP 401');
    expect(screen.getByTestId('adm-hacc-issued').textContent).toContain('LORE_MCP_CLIENT_SECRET_TESTER_KIMI');
    expect(calls.find(c => c.url === '/lore/kc/agent-client')?.body).toEqual({ profile: 'tester', harness: 'kimi-code' });
    expect(window.location.href).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET);
  });

  it('отказ выпуска — текст сервера', async () => {
    window.history.replaceState(null, '', '/?adm-harness=kimi-code&adm-acc=tester');
    const { f } = fake(() => json(tree()), () => json({ error: 'ROLE_ABOVE_HARNESS_MAIN', detail: 'нельзя: причина сервера' }, 409));
    mount(f);
    fireEvent.click(await screen.findByTestId('adm-hacc-issue'));
    expect((await screen.findByTestId('adm-hacc-error')).textContent).toContain('причина сервера');
  });

  it('выпущенная учётка: сменить секрет, выключить; «перешёл?» и дата смены видны', async () => {
    window.history.replaceState(null, '', '/?adm-harness=kimi-code&adm-acc=pm');
    const { f, calls } = fake(() => json(tree()));
    mount(f);
    expect(await screen.findByTestId('adm-hacc-rotate')).toBeTruthy();
    expect(screen.getByTestId('adm-hacc-switched').getAttribute('data-seen')).toBe('true');
    expect(screen.getByTestId('adm-hacc-rotated').textContent).toContain('2026-11-21');
    fireEvent.click(screen.getByTestId('adm-hacc-toggle'));
    await waitFor(() => expect(calls.some(c => c.url === '/lore/kc/agent-client/lore-mcp-pm_kimi/disable' && c.method === 'POST')).toBe(true));
  });
});
