// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04 — клиент v2 к /lore/slice/*: свой, не
// src/api v1 (заморожен). Тело слайса с метаданными полноты S1 отдаётся как
// есть; ошибка несёт HTTP-статус, чтобы kit различил «нет прав» и «сбой».
import { describe, expect, it, vi } from 'vitest';
import { classifyError } from '@seidr/kit';
import { createAuthSession, type OidcUserLike, type UserManagerLike } from '@seidr/kit/auth';
import { LoreApiError, fetchSlice } from './loreClient';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fetchSlice', () => {
  it('GET /lore/slice/{id} с параметрами; тело с метаданными полноты — как пришло', async () => {
    const fetchImpl = vi.fn(async () => json(200, { rows: [{ a: 1 }], truncated: 'unknown', hint: 'h' }));
    const body = await fetchSlice('sprints', { project: 'x' }, { fetchImpl, base: 'http://h' });
    expect(body).toEqual({ rows: [{ a: 1 }], truncated: 'unknown', hint: 'h' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://h/lore/slice/sprints?project=x');
    expect(new Headers(init.headers).get('X-Seer-Role')).toBe('admin');
  });

  it('тело без rows — ноль строк, а не падение', async () => {
    const body = await fetchSlice('adrs', undefined, { fetchImpl: async () => json(200, {}), base: 'http://h' });
    expect(body.rows).toEqual([]);
  });

  it('403 — LoreApiError со статусом: kit читает как «нет прав», а не «пусто»', async () => {
    const err = await fetchSlice('adrs', undefined, {
      fetchImpl: async () => json(403, { error: 'FORBIDDEN', detail: 'нет роли' }), base: 'http://h',
    }).catch(e => e);
    expect(err).toBeInstanceOf(LoreApiError);
    expect(err.status).toBe(403);
    expect(err.message).toContain('нет роли');
    expect(classifyError(err)).toBe('forbidden');
  });

  it('401 — ошибка входа (error), 502 с HTML — «недоступен», статус сохранён', async () => {
    const e401 = await fetchSlice('adrs', undefined, {
      fetchImpl: async () => new Response('<html/>', { status: 401 }), base: 'http://h',
    }).catch(e => e);
    expect(e401.status).toBe(401);
    expect(classifyError(e401)).toBe('error');
    const e502 = await fetchSlice('adrs', undefined, {
      fetchImpl: async () => new Response('<html/>', { status: 502 }), base: 'http://h',
    }).catch(e => e);
    expect(e502.status).toBe(502);
    expect(e502.code).toBe('UNREACHABLE');
  });

  it('200 с не-JSON телом — ошибка, а не «пусто»', async () => {
    const err = await fetchSlice('adrs', undefined, {
      fetchImpl: async () => new Response('<html/>', { status: 200, headers: { 'content-type': 'text/html' } }), base: 'http://h',
    }).catch(e => e);
    expect(err).toBeInstanceOf(LoreApiError);
    expect(err.code).toBe('NON_JSON');
  });

  // S3-18: у v2 свой вход (kit auth). Токен v1 (oidc.user:* на чужом origin) не читаем.
  const NOW = 1_800_000_000_000;
  const mgr = (stored: OidcUserLike | null) => {
    const m = {
      getUser: vi.fn(async () => stored),
      signinRedirect: vi.fn(async () => {}),
      signinRedirectCallback: vi.fn(),
      signinSilent: vi.fn(async () => null),
      signoutRedirect: vi.fn(async () => {}),
      removeUser: vi.fn(async () => {}),
      events: { addUserLoaded: () => {}, addUserUnloaded: () => {}, addSilentRenewError: () => {} },
    };
    return m as typeof m & UserManagerLike;
  };
  const loc = () => ({ href: 'http://h/?sec=adr', origin: 'http://h', pathname: '/', search: '?sec=adr', hash: '' });

  it('S3-18: вход включён, сессии нет — ведёт на вход и НЕ шлёт запрос без Authorization', async () => {
    const m = mgr(null);
    const session = createAuthSession({ enabled: true, manager: () => m, location: loc, now: () => NOW });
    await session.init();
    const fetchImpl = vi.fn(async () => json(200, { rows: [] }));
    const err = await fetchSlice('adrs', undefined, { fetchImpl, base: 'http://h', session }).catch(e => e);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(m.signinRedirect).toHaveBeenCalledWith({ state: '/?sec=adr' });
    expect(err.status).toBe(401);
    expect(classifyError(err)).toBe('error');
  });

  it('S3-18: с токеном своей сессии — Authorization: Bearer, без dev-роли', async () => {
    const session = createAuthSession({
      enabled: true, manager: () => mgr({ access_token: 'T2', expires_at: NOW / 1000 + 600 }), location: loc, now: () => NOW,
    });
    await session.init();
    const fetchImpl = vi.fn(async () => json(200, { rows: [] }));
    await fetchSlice('adrs', undefined, { fetchImpl, base: 'http://h', session });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer T2');
    expect(new Headers(init.headers).get('X-Seer-Role')).toBeNull();
  });

  it('S3-18: 401 от API — сессия «истекла», ошибка с 401, а не пустой список', async () => {
    const session = createAuthSession({
      enabled: true, manager: () => mgr({ access_token: 'T3', expires_at: NOW / 1000 + 600 }), location: loc, now: () => NOW,
    });
    await session.init();
    const err = await fetchSlice('adrs', undefined, {
      fetchImpl: async () => json(401, { error: 'UNAUTHENTICATED' }), base: 'http://h', session,
    }).catch(e => e);
    expect(err).toBeInstanceOf(LoreApiError);
    expect(err.status).toBe(401);
    expect(session.getState().status).toBe('expired');
  });
});
