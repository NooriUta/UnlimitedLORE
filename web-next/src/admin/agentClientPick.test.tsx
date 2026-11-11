// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-AGENT-CLIENT-PICK — машинный клиент
// lore-mcp-full_<машина> привязывается к человеку в v2.
//
// Владелица 08.11: «админка не доделана — привязать lore-mcp-full_arharaga к
// человеку». Бэкенд (#1062) уже отдаёт ось машинного клиента из ролей его
// сервисной учётки (GET /lore/kc/agents → agent_scope:["agent-full"]). В v1
// форма «Учётка» заморожена (D-2026-UXR-V2-FOLDER-V1-FROZEN), а в v2 у сироты
// KC — клиента без агента в графе — не было действия вовсе: только имя в списке.
//
// Правило выбора (то же, что v1 clientOptions): в «Учётку» идут клиенты KC без
// агента в графе, у которых ось НЕ пуста. Ось пуста — «оси не несёт, привязка
// запрещена» словами, а не молча пропавший пункт.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AgentsScreen } from './AgentsScreen';
import { bindKcClient, orphanBindOptions } from './wizards';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const ROWS = [
  { actor_id: 'A1', name: 'Claude Code (full)', client_id: 'lore-mcp-full', agent_role: 'full', machine_id: 'lorcetus', session_id: null, harness: 'claude-code', owner_kc_sub: ['u1'], owner_display_name: ['omiloreadmin'] },
];

// Ответ GET /lore/kc/agents после #1062: у машинного клиента своих ролей нет,
// ось — из сервисной учётки.
const KC_AGENTS = [
  { clientId: 'lore-mcp-full', id: 'k0', enabled: true, agent_scope: ['agent-full'] },
  { clientId: 'lore-mcp-full_kimi', id: 'k1', enabled: true, agent_scope: ['agent-full'] },
  { clientId: 'legacy-bot', id: 'k2', enabled: true, agent_scope: [] },
];
const ORPHANS = [
  { clientId: 'lore-mcp-full_kimi', id: 'k1', enabled: true },
  { clientId: 'legacy-bot', id: 'k2', enabled: true },
];
const MATRIX = [
  { kc_sub: 'u1', display_name: 'omiloreadmin', cells: [] },
  { kc_sub: 'u2', display_name: 'kimi', cells: [] },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fake() {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push({ url, body });
      return json({ ok: true, actor_id: body.actor_id, owner_linked: true });
    }
    if (url.startsWith('/lore/kc/agent-orphans')) return json({ orphans: ORPHANS });
    if (url.startsWith('/lore/kc/agents')) return json(KC_AGENTS);
    if (url.startsWith('/lore/slice/role_matrix')) return json({ rows: MATRIX });
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [] });
    return json({ rows: ROWS });
  }) as unknown as typeof fetch;
  return { f, posts };
}

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={f} /></KitLangProvider>);

describe('S4-AGENT-CLIENT-PICK · модель выбора учётки', () => {
  it('машинный клиент с осью из сервисной учётки — в выборе, профиль и машина из имени и оси', () => {
    const opts = orphanBindOptions(ORPHANS, KC_AGENTS);
    expect(opts).toEqual([
      { clientId: 'lore-mcp-full_kimi', profiles: ['full'], machine: 'kimi' },
      { clientId: 'legacy-bot', profiles: [], machine: null },
    ]);
  });

  it('клиента нет в ответе /kc/agents — оси не знаем, привязки нет', () => {
    expect(orphanBindOptions([{ clientId: 'x' }], [])).toEqual([
      { clientId: 'x', profiles: [], machine: null },
    ]);
  });

  it('привязка: актор kind=agent с actor_id=client_id, затем владелец с профилем и машиной', async () => {
    const { f, posts } = fake();
    await bindKcClient({ clientId: 'lore-mcp-full_kimi', ownerSub: 'u2', profile: 'full', machine: 'kimi' }, f);
    expect(posts).toEqual([
      { url: '/lore/actor', body: { actor_id: 'lore-mcp-full_kimi', name: 'lore-mcp-full_kimi', kind: 'agent' } },
      { url: '/lore/actor/owner', body: { actor_id: 'lore-mcp-full_kimi', client_id: 'lore-mcp-full_kimi', kc_sub: 'u2', agent_role: 'full', machine_id: 'kimi' } },
    ]);
  });
});

describe('S4-AGENT-CLIENT-PICK · раздел «Агенты»: привязать учётку к человеку', () => {
  it('lore-mcp-full_<машина> есть в «Учётке»; клиент без оси — назван «привязка запрещена»', async () => {
    mount(fake().f);
    const form = await screen.findByTestId('adm-bind-client');
    const sel = await within(form).findByTestId('adm-bind-client-pick');
    const opt = within(sel).getByRole('option', { name: /lore-mcp-full_kimi/ }) as HTMLOptionElement;
    expect(opt.disabled).toBe(false);
    const legacy = within(sel).getByRole('option', { name: /legacy-bot/ }) as HTMLOptionElement;
    expect(legacy.disabled).toBe(true);
    expect(legacy.textContent).toContain('привязка запрещена');
  });

  it('выбор учётки и владельца → привязка уходит на сервер, список перечитывается', async () => {
    const { f, posts } = fake();
    mount(f);
    const form = await screen.findByTestId('adm-bind-client');
    fireEvent.change(await within(form).findByTestId('adm-bind-client-pick'), { target: { value: 'lore-mcp-full_kimi' } });
    fireEvent.change(await within(form).findByTestId('adm-bind-owner'), { target: { value: 'u2' } });
    fireEvent.click(within(form).getByTestId('adm-bind-go'));
    await waitFor(() => expect(posts.map(p => p.url)).toEqual(['/lore/actor', '/lore/actor/owner']));
    expect(posts[1].body).toMatchObject({ client_id: 'lore-mcp-full_kimi', kc_sub: 'u2', agent_role: 'full', machine_id: 'kimi' });
    expect(await within(form).findByTestId('adm-bind-done')).toBeTruthy();
  });

  it('без владельца кнопка не активна', async () => {
    mount(fake().f);
    const form = await screen.findByTestId('adm-bind-client');
    fireEvent.change(await within(form).findByTestId('adm-bind-client-pick'), { target: { value: 'lore-mcp-full_kimi' } });
    expect((within(form).getByTestId('adm-bind-go') as HTMLButtonElement).disabled).toBe(true);
  });
});
