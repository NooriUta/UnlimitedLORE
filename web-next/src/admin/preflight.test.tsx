// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-31 п.4 (решение 4а) — чеклист включения auth из
// старой вкладки v1 «Настройки» переехал на Главную карточками.
//
// Источник — GET /lore/kc/auth-preflight (сервер сам считает число админов,
// мост KC и agent_scope). Честно: admin_count=-1 — «не смогли проверить», не 0;
// 403 — «нет прав», а не «всё в порядке»; сбой — словами, с «Повторить».
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AuthPreflight } from './AuthPreflight';
import { AdminHome } from './HomeScreen';
import { parsePreflight, preflightChecks } from './preflight';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const PF = {
  auth_enabled: false, kc_configured: true, kc_reachable: true, kc_error: '', admin_count: 2,
  agent_scope_enforced: false, can_enable_auth: true, hint: 'включение: LORE_AUTH_ENABLED=true + рестарт',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const fake = (body: unknown, status = 200) => vi.fn(async (url: string) => {
  if (url.startsWith('/lore/kc/auth-preflight')) return json(body, status);
  return json({ rows: [] });
}) as unknown as typeof fetch;

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><AuthPreflight fetchImpl={f} /></KitLangProvider>);

describe('S7B-31 · модель preflight', () => {
  it('разбор ответа; число админов -1 — «неизвестно», не 0', () => {
    const pf = parsePreflight({ ...PF, admin_count: -1, kc_configured: false, kc_reachable: false });
    const c = preflightChecks(pf);
    expect(c.find(x => x.id === 'admins')).toMatchObject({ state: 'unknown' });
    expect(c.find(x => x.id === 'kc')).toMatchObject({ state: 'fail', why: 'off' });
  });

  it('KC настроен, но не ответил — провал с ошибкой моста', () => {
    const c = preflightChecks(parsePreflight({ ...PF, kc_reachable: false, kc_error: 'timeout' }));
    expect(c.find(x => x.id === 'kc')).toMatchObject({ state: 'fail', why: 'down', error: 'timeout' });
  });

  it('всё в порядке: админы есть, KC отвечает; scope — по флагу сервера', () => {
    const c = preflightChecks(parsePreflight(PF));
    expect(c.map(x => [x.id, x.state])).toEqual([['admins', 'ok'], ['kc', 'ok'], ['scope', 'fail'], ['enable', 'ok']]);
  });

  it('ответ без булевых полей — сбой, а не «выключено»', () => {
    expect(() => parsePreflight({ admin_count: 1 })).toThrow(/malformed/);
  });
});

describe('S7B-31 · карточки preflight', () => {
  it('четыре проверки карточками; включать нельзя — подсказка сервера', async () => {
    mount(fake({ ...PF, admin_count: 0, can_enable_auth: false, hint: 'сначала заведите admin' }));
    const box = await screen.findByTestId('adm-pf');
    expect(within(box).getByTestId('adm-pf-admins').getAttribute('data-state')).toBe('fail');
    expect(within(box).getByTestId('adm-pf-enable').getAttribute('data-state')).toBe('fail');
    expect(within(box).getByTestId('adm-pf-enable').textContent).toMatch(/сначала заведите admin/);
    expect(within(box).getByTestId('adm-pf-kc').getAttribute('data-state')).toBe('ok');
  });

  it('число админов неизвестно — «не смогли проверить», карточка не зелёная', async () => {
    mount(fake({ ...PF, admin_count: -1, kc_configured: false, kc_reachable: false, can_enable_auth: false }));
    const card = await screen.findByTestId('adm-pf-admins');
    expect(card.getAttribute('data-state')).toBe('unknown');
    expect(card.textContent).toMatch(/неизвестно|не смогли/i);
  });

  it('403 — «нет прав», а не чеклист', async () => {
    mount(fake({ error: 'FORBIDDEN', detail: 'admin only' }, 403));
    expect(await screen.findByTestId('adm-pf-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('adm-pf-admins')).toBeNull();
  });

  it('сбой — словами и «Повторить»', async () => {
    mount(fake({ error: 'DOWN', detail: 'bridge down' }, 502));
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryByTestId('adm-pf-admins')).toBeNull();
  });

  it('на Главной — блок preflight рядом с «требует внимания»', async () => {
    render(<KitLangProvider lang="ru"><AdminHome fetchImpl={fake(PF)} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-pf-kc')).toBeTruthy();
  });
});
