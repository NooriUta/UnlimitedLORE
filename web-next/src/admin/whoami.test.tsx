// @vitest-environment jsdom
// SPRINT_LORE_AGENT_OBSERVABILITY/AO-WHOAMI — строка «Вы: …» в админке по GET /lore/whoami.
//
// Различаем то, что легко выдать друг за друга:
//   • опознан — имя, роль первой оси, человек/агент;
//   • не опознан (identity.state=unknown) — «LORE вас не знает», а не «нет прав»;
//   • граф не прочитан (state=error) или запрос упал — «не смогли проверить»;
//   • auth выключен — роль из заголовка, сказано, что она не проверена.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AdminForbidden, WhoamiBar, adminDenied } from './WhoamiBar';

beforeAll(() => { registerGameIcons(gameIcons); });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const fake = (body: unknown, status = 200) =>
  vi.fn(async () => json(body, status)) as unknown as typeof fetch;
const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><WhoamiBar fetchImpl={f} /></KitLangProvider>);

describe('AO-WHOAMI · «Вы: …»', () => {
  it('человек опознан — имя и роль', async () => {
    mount(fake({ auth_enabled: true, kind: 'human', seer_role: 'admin',
      identity: { state: 'known', display_name: 'omiloreadmin' } }));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.getAttribute('data-state')).toBe('known');
    expect(bar.textContent).toContain('omiloreadmin');
    expect(bar.textContent).toContain('admin');
  });

  it('агент — профиль и клиент', async () => {
    mount(fake({ auth_enabled: true, kind: 'agent', profile: 'full', client_id: 'lore-mcp-full', seer_role: 'viewer',
      identity: { state: 'known', name: 'Claude Code (full)' } }));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.textContent).toContain('Claude Code (full)');
    expect(bar.textContent).toContain('full');
  });

  it('не опознан — «LORE вас не знает», а не «нет прав»', async () => {
    mount(fake({ auth_enabled: true, kind: 'human', seer_role: 'viewer', sub: 's-1',
      identity: { state: 'unknown', reason: 'человека с kc_sub s-1 нет в графе' } }));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.getAttribute('data-state')).toBe('unknown');
    expect(bar.textContent).toMatch(/не опознан/i);
    expect(bar.textContent).not.toMatch(/нет прав/i);
  });

  it('граф не прочитан / запрос упал — «не смогли проверить»', async () => {
    mount(fake({ error: 'BAD_GATEWAY', detail: 'down' }, 502));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.getAttribute('data-state')).toBe('error');
    expect(bar.textContent).toMatch(/не смогли проверить/i);
  });

  it('auth выключен — роль не проверена, так и сказано', async () => {
    mount(fake({ auth_enabled: false, kind: 'unverified', seer_role: 'admin' }));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.getAttribute('data-state')).toBe('unverified');
    expect(bar.textContent).toMatch(/не проверена/i);
  });

  // AP-09 (автотест RBAC 15.11.2026, кейс AD-02): не опознан — в тексте логин из токена, UUID — только в подсказке.
  it('AP-09: не опознан — логин из токена, а не сырой UUID; UUID в подсказке', async () => {
    const uuid = 'b0f766da-9b45-4763-b43b-13864bf67ff2';
    mount(fake({ auth_enabled: true, kind: 'human', seer_role: 'admin', sub: uuid, username: 'test-admin',
      identity: { state: 'unknown', reason: 'человека с kc_sub нет в графе' } }));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.textContent).toContain('test-admin');
    expect(bar.textContent).not.toContain(uuid);
    expect(bar.getAttribute('title')).toContain(uuid);
  });

  it('AP-09: логина в токене нет — честно «—», UUID всё равно не в тексте', async () => {
    const uuid = 'b0f766da-9b45-4763-b43b-13864bf67ff2';
    mount(fake({ auth_enabled: true, kind: 'human', seer_role: 'viewer', sub: uuid, username: null,
      identity: { state: 'unknown' } }));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.textContent).not.toContain(uuid);
  });
});

// AP-08 (автотест RBAC 15.11.2026, кейс AD-01): viewer по прямой ссылке ?mod=admin видел админку
// и «0 отказов». Экран админки — только admin/superadmin; прочим — честное «нет прав» с их ролью.
describe('AP-08 · вход в админку по роли', () => {
  it('viewer — «нет прав», роль названа; admin и superadmin — проходят', () => {
    expect(adminDenied({ auth_enabled: true, kind: 'human', seer_role: 'viewer' })).toBe(true);
    expect(adminDenied({ auth_enabled: true, kind: 'human', seer_role: null })).toBe(true);
    expect(adminDenied({ auth_enabled: true, kind: 'human', seer_role: 'admin' })).toBe(false);
    expect(adminDenied({ auth_enabled: true, kind: 'human', seer_role: 'superadmin' })).toBe(false);
  });

  it('«не смогли проверить» и выключенный auth — не «нет прав» (решает сервер своими 403)', () => {
    expect(adminDenied(null)).toBe(false);
    expect(adminDenied({ auth_enabled: false, kind: 'unverified', seer_role: 'viewer' })).toBe(false);
  });

  it('экран отказа: заголовок «нет прав» и роль вызывающего', async () => {
    render(<KitLangProvider lang="ru"><AdminForbidden role="viewer" /></KitLangProvider>);
    const box = await screen.findByText(/viewer/);
    expect(box).toBeTruthy();
    expect(document.body.textContent).toMatch(/admin/);
  });
});
