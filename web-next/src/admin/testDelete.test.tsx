// @vitest-environment jsdom
// SPRINT_LORE_ADMIN_POLISH/AP-01 — «Удалить» тестовую учётку агента / человека.
// Кнопка — только у тестовых имён (D-2026-ONLY-TEST-PREFIXED-ACCOUNTS); перед
// применением — план сервера (dry_run); подтверждение — вводом clientId / логина;
// пользователь Keycloak в плане человека — строкой «остаётся».
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AgentTestDelete, PersonTestDelete } from './TestAccountDelete';
import { isTestAgentClient, isTestPersonLogin } from './testDelete';

beforeAll(() => { registerGameIcons(gameIcons); });

const wrap = (ui: React.ReactElement) => render(<KitLangProvider lang="ru">{ui}</KitLangProvider>);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const AGENT = 'lore-mcp-full_TestUat';
const AGENT_PLAN = {
  client_id: AGENT,
  keycloak: {
    client_id: AGENT, state: 'present', client_uuid: 'uuid-1', action: 'delete_client',
    service_account_user: { id: 'sa-1', username: 'service-account-lore-mcp-full_testuat', action: 'removed_with_client' },
    roles: ['admin', 'lore-mcp/agent-full'], roles_checked: true,
  },
  lore: { actors: [{ actor_id: AGENT, owners: ['sub-owner'], agent_role: 'full', edges: { OWNED_BY: 1 }, action: 'delete' }] },
};

function fake() {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    if (url === '/lore/kc/users') {
      return json([
        { id: 'sub-1', username: 'test-user-1', email: null, enabled: true, roles: [] },
        { id: 'sub-real', username: 'omiloreadmin', email: null, enabled: true, roles: [] },
      ]);
    }
    if (url === `/lore/kc/agent-client/${AGENT}/delete`) {
      return json(body?.dry_run
        ? { client_id: AGENT, ok: true, dry_run: true, plan: AGENT_PLAN }
        : { client_id: AGENT, ok: true, kc_client_deleted: true, service_account_user_removed: true, actors_deleted: [AGENT] });
    }
    if (url === '/lore/user/sub-1/delete') {
      return json({
        kc_sub: 'sub-1', ok: true, dry_run: true, username: 'test-user-1',
        plan: {
          kc_sub: 'sub-1',
          kc_user: { id: 'sub-1', username: 'test-user-1', action: 'kept', note: 'LORE не удаляет пользователей Keycloak' },
          lore: { user: { kc_sub: 'sub-1', display_name: 'Test User 1', edges: {} }, project_roles: [{ project: 'lore-sandbox', role: 'viewer' }] },
          agents: [AGENT_PLAN],
          blockers: [],
        },
      });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('глоб тестовых имён — тот же, что на сервере', () => {
  it('агент', () => {
    expect(isTestAgentClient('lore-mcp-full_TestUat')).toBe(true);
    expect(isTestAgentClient('lore-mcp-full_TestU1')).toBe(true);
    expect(isTestAgentClient('lore-mcp-full')).toBe(false);
    expect(isTestAgentClient('lore-mcp-full_LorCetus')).toBe(false);
    expect(isTestAgentClient('lore-mcp-full_testuat')).toBe(false);
  });
  it('человек', () => {
    expect(isTestPersonLogin('test-user-1')).toBe(true);
    expect(isTestPersonLogin('TEST-broker-1')).toBe(true);
    expect(isTestPersonLogin('omiloreadmin')).toBe(false);
    expect(isTestPersonLogin(null)).toBe(false);
  });
});

describe('агент', () => {
  it('у реального агента кнопки «Удалить» нет', () => {
    const { f, calls } = fake();
    wrap(<AgentTestDelete clientId="lore-mcp-full" fetchImpl={f} />);
    expect(screen.queryByTestId('adm-testdel-open-lore-mcp-full')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('тестовый: план сервера → без ввода clientId не удаляет → ввод → удаление', async () => {
    const { f, calls } = fake();
    const deleted = vi.fn();
    wrap(<AgentTestDelete clientId={AGENT} fetchImpl={f} onDeleted={deleted} />);
    fireEvent.click(screen.getByTestId(`adm-testdel-open-${AGENT}`));
    await screen.findByTestId(`kit-diff-row-kc:${AGENT}`);
    expect(calls[0]).toEqual({ url: `/lore/kc/agent-client/${AGENT}/delete`, body: { dry_run: true } });
    expect(screen.getByTestId('kit-diff-row-kcsa:sa-1')).toBeTruthy();
    expect(screen.getByTestId(`kit-diff-row-actor:${AGENT}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    expect(calls).toHaveLength(1);
    fireEvent.change(screen.getByTestId('kit-diff-confirm'), { target: { value: AGENT } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    await screen.findByTestId('adm-testdel-done');
    expect(calls[1]).toEqual({ url: `/lore/kc/agent-client/${AGENT}/delete`, body: { dry_run: false } });
    expect(deleted).toHaveBeenCalledTimes(1);
  });
});

describe('человек', () => {
  it('реальный логин — кнопки нет', async () => {
    const { f, calls } = fake();
    wrap(<PersonTestDelete kcSub="sub-real" fetchImpl={f} />);
    await waitFor(() => expect(calls.some(c => c.url === '/lore/kc/users')).toBe(true));
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByTestId('adm-testdel-open-sub-real')).toBeNull();
  });

  it('тестовый логин: в плане пользователь KC остаётся, роли и агент уходят', async () => {
    const { f } = fake();
    wrap(<PersonTestDelete kcSub="sub-1" fetchImpl={f} />);
    fireEvent.click(await screen.findByTestId('adm-testdel-open-sub-1'));
    const kept = await screen.findByTestId('kit-diff-row-kcuser:sub-1');
    expect(kept.getAttribute('data-kind')).toBe('same');
    expect(screen.getByTestId('kit-diff-row-role:lore-sandbox').getAttribute('data-kind')).toBe('remove');
    expect(screen.getByTestId(`kit-diff-row-kc:${AGENT}`)).toBeTruthy();
  });
});
