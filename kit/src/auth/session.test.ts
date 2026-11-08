// SPRINT_UXR_S3_V2_INFRA/S3-18 — общий вход kit: сессия OIDC поверх
// UserManager-подобного объекта (боевой — oidc-client-ts, здесь — подделка).
// Что держим: без токена запрос НЕ уходит и ведёт на вход; с токеном —
// Bearer; 401 от API — состояние «сессия истекла»; выключенный вход — прежнее
// поведение (dev-роль); callback-маршрут, тихое продление, выход.
import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, createAuthSession, isCallbackUrl, type OidcUserLike, type UserManagerLike } from './session';

const NOW = 1_800_000_000_000;
const user = (over: Partial<OidcUserLike> = {}): OidcUserLike => ({
  access_token: 'tok-1', expires_at: NOW / 1000 + 600, profile: { sub: 'sub-1', preferred_username: 'volva' }, ...over,
});

function fakeManager(init: { stored?: OidcUserLike | null; silent?: () => Promise<OidcUserLike | null>; callback?: () => Promise<OidcUserLike> } = {}) {
  const loaded: ((u: OidcUserLike) => void)[] = [];
  const renewErr: ((e: Error) => void)[] = [];
  const m = {
    getUser: vi.fn(async () => init.stored ?? null),
    signinRedirect: vi.fn(async () => {}),
    signinRedirectCallback: vi.fn(init.callback ?? (async () => user({ state: '/?sec=adr' }))),
    signinSilent: vi.fn(init.silent ?? (async () => user({ access_token: 'tok-renewed' }))),
    signoutRedirect: vi.fn(async () => {}),
    removeUser: vi.fn(async () => {}),
    events: {
      addUserLoaded: (cb: (u: OidcUserLike) => void) => { loaded.push(cb); },
      addUserUnloaded: () => {},
      addSilentRenewError: (cb: (e: Error) => void) => { renewErr.push(cb); },
    },
    fireLoaded: (u: OidcUserLike) => loaded.forEach(f => f(u)),
    fireRenewError: () => renewErr.forEach(f => f(new Error('renew failed'))),
  };
  return m as typeof m & UserManagerLike;
}

const loc = (href = 'https://new.lore.example/?sec=adr') => () => {
  const u = new URL(href);
  return { href: u.href, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash };
};

function okFetch() {
  return vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
    new Response('{"rows":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

const authOf = (f: ReturnType<typeof okFetch>, call = 0) =>
  new Headers((f.mock.calls[call][1] as RequestInit | undefined)?.headers).get('Authorization');

describe('S3-18 · вход выключен — поведение прежнее', () => {
  it('статус disabled, заголовок dev-роли, менеджер OIDC даже не создаётся', async () => {
    const make = vi.fn(() => fakeManager());
    const s = createAuthSession({ enabled: false, manager: make, location: loc() });
    await s.init();
    expect(s.getState().status).toBe('disabled');
    expect(s.headers()).toEqual({ 'X-Seer-Role': 'admin' });
    const f = okFetch();
    await s.wrapFetch(f)('/lore/slice/adrs');
    expect(new Headers(f.mock.calls[0][1]?.headers).get('X-Seer-Role')).toBe('admin');
    expect(make).not.toHaveBeenCalled();
  });
});

describe('S3-18 · без токена запрос не уходит', () => {
  it('нет сессии → ведёт на вход и НЕ шлёт запрос без Authorization', async () => {
    const m = fakeManager({ stored: null });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => NOW });
    await s.init();
    expect(s.getState().status).toBe('signed_out');
    const f = okFetch();
    await expect(s.wrapFetch(f)('/lore/slice/adrs')).rejects.toBeInstanceOf(AuthRequiredError);
    expect(f).not.toHaveBeenCalled();
    expect(m.signinRedirect).toHaveBeenCalledWith({ state: '/?sec=adr' });
  });

  it('AuthRequiredError несёт 401 — kit рисует сбой входа, а не «пусто»', () => {
    const e = new AuthRequiredError();
    expect(e.status).toBe(401);
    expect(e.code).toBe('UNAUTHENTICATED');
  });
});

describe('S3-18 · с токеном — Bearer', () => {
  it('сохранённая действующая сессия → signed_in, Authorization: Bearer <access_token>', async () => {
    const m = fakeManager({ stored: user() });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => NOW });
    await s.init();
    expect(s.getState().status).toBe('signed_in');
    expect(s.getState().user?.name).toBe('volva');
    expect(s.headers()).toEqual({ Authorization: 'Bearer tok-1' });
    const f = okFetch();
    await s.wrapFetch(f)('/lore/slice/adrs', { headers: { Accept: 'application/json' } });
    expect(authOf(f)).toBe('Bearer tok-1');
    expect(new Headers(f.mock.calls[0][1]?.headers).get('Accept')).toBe('application/json');
    expect(new Headers(f.mock.calls[0][1]?.headers).get('X-Seer-Role')).toBeNull();
  });

  it('протухший токен на старте — тихое продление, затем Bearer нового токена', async () => {
    const m = fakeManager({ stored: user({ expires_at: NOW / 1000 - 5 }) });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => NOW });
    await s.init();
    expect(m.signinSilent).toHaveBeenCalledTimes(1);
    expect(s.getState().status).toBe('signed_in');
    expect(s.headers()).toEqual({ Authorization: 'Bearer tok-renewed' });
  });

  it('продление не вышло на старте → «сессия истекла», а не тихий вход без токена', async () => {
    const m = fakeManager({ stored: user({ expires_at: NOW / 1000 - 5 }), silent: async () => { throw new Error('no refresh'); } });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => NOW });
    await s.init();
    expect(s.getState().status).toBe('expired');
    expect(s.getState().interrupted).toBe(false);
    expect(s.headers()).toEqual({});
  });

  it('токен протух посреди работы — перед запросом продлевается один раз на всех', async () => {
    let t = NOW;
    const m = fakeManager({ stored: user() });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => t });
    await s.init();
    t = NOW + 3_600_000;
    const f = okFetch();
    const w = s.wrapFetch(f);
    m.signinSilent.mockImplementation(async () => user({ access_token: 'tok-2', expires_at: t / 1000 + 600 }));
    await Promise.all([w('/lore/a'), w('/lore/b')]);
    expect(m.signinSilent).toHaveBeenCalledTimes(1);
    expect(authOf(f, 0)).toBe('Bearer tok-2');
    expect(authOf(f, 1)).toBe('Bearer tok-2');
  });

  it('событие userLoaded (автопродление oidc-client-ts) подменяет токен', async () => {
    const m = fakeManager({ stored: user() });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => NOW });
    await s.init();
    m.fireLoaded(user({ access_token: 'tok-auto' }));
    expect(s.headers()).toEqual({ Authorization: 'Bearer tok-auto' });
  });
});

describe('S3-18 · 401 от API → «сессия истекла»', () => {
  it('ответ 401 переводит сессию в expired (interrupted) и уведомляет подписчиков', async () => {
    const m = fakeManager({ stored: user() });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => NOW });
    await s.init();
    const seen: string[] = [];
    s.subscribe(() => seen.push(s.getState().status));
    const f = vi.fn(async () => new Response('', { status: 401 }));
    const res = await s.wrapFetch(f)('/lore/slice/adrs');
    expect(res.status).toBe(401);
    expect(s.getState().status).toBe('expired');
    expect(s.getState().interrupted).toBe(true);
    expect(seen).toContain('expired');
    expect(s.headers()).toEqual({});
  });

  it('после истечения запрос не уходит и сам на вход не уводит (несохранённое не теряем)', async () => {
    const m = fakeManager({ stored: user() });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => NOW });
    await s.init();
    s.expire();
    m.signinSilent.mockImplementation(async () => { throw new Error('no'); });
    const f = okFetch();
    await expect(s.wrapFetch(f)('/lore/x')).rejects.toBeInstanceOf(AuthRequiredError);
    expect(f).not.toHaveBeenCalled();
    expect(m.signinRedirect).not.toHaveBeenCalled();
  });

  it('ошибка тихого продления при протухшем токене — тоже expired', async () => {
    let t = NOW;
    const m = fakeManager({ stored: user() });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => t });
    await s.init();
    t = NOW + 3_600_000;
    m.fireRenewError();
    expect(s.getState().status).toBe('expired');
  });

  it('при выключенном входе 401 сессию не трогает (dev без OIDC)', async () => {
    const s = createAuthSession({ enabled: false, location: loc() });
    await s.init();
    await s.wrapFetch(vi.fn(async () => new Response('', { status: 401 })))('/lore/me/settings');
    expect(s.getState().status).toBe('disabled');
  });
});

describe('S3-18 · callback-маршрут', () => {
  it('распознаёт возврат из Keycloak: путь redirect + state + code|error', () => {
    expect(isCallbackUrl(new URL('https://h/?code=a&state=b'), '/')).toBe(true);
    expect(isCallbackUrl(new URL('https://h/?error=access_denied&state=b'), '/')).toBe(true);
    expect(isCallbackUrl(new URL('https://h/?sec=adr'), '/')).toBe(false);
    expect(isCallbackUrl(new URL('https://h/kit?code=a&state=b'), '/')).toBe(false);
    expect(isCallbackUrl(new URL('https://h/auth/callback?code=a&state=b'), '/auth/callback')).toBe(true);
  });

  it('обменивает code на токен и возвращает на исходный адрес, без code в URL', async () => {
    const m = fakeManager();
    const replace = vi.fn();
    const s = createAuthSession({
      enabled: true, manager: () => m, location: loc('https://new.lore.example/?code=c1&state=s1&session_state=x'),
      replaceUrl: replace, now: () => NOW,
    });
    await s.init();
    expect(m.signinRedirectCallback).toHaveBeenCalledWith('https://new.lore.example/?code=c1&state=s1&session_state=x');
    expect(replace).toHaveBeenCalledWith('/?sec=adr');
    expect(s.getState().status).toBe('signed_in');
  });

  it('чужой state (не путь своего приложения) — возврат на корень, а не открытый редирект', async () => {
    const m = fakeManager({ callback: async () => user({ state: 'https://evil.example/' }) });
    const replace = vi.fn();
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc('https://h/?code=c&state=s'), replaceUrl: replace, now: () => NOW });
    await s.init();
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('callback упал → состояние error с причиной, не белый экран', async () => {
    const m = fakeManager({ callback: async () => { throw new Error('invalid_grant'); } });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc('https://h/?code=c&state=s'), replaceUrl: vi.fn(), now: () => NOW });
    await s.init();
    expect(s.getState().status).toBe('error');
    expect(String(s.getState().error)).toMatch(/invalid_grant/);
  });
});

describe('S3-18 · выход', () => {
  it('logout → signoutRedirect Keycloak', async () => {
    const m = fakeManager({ stored: user() });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => NOW });
    await s.init();
    await s.logout();
    expect(m.signoutRedirect).toHaveBeenCalledTimes(1);
  });

  it('Keycloak недоступен — сессия гасится локально, статус signed_out с отметкой «вышли сами»', async () => {
    const m = fakeManager({ stored: user() });
    m.signoutRedirect.mockImplementation(async () => { throw new Error('down'); });
    const s = createAuthSession({ enabled: true, manager: () => m, location: loc(), now: () => NOW });
    await s.init();
    await s.logout();
    expect(m.removeUser).toHaveBeenCalled();
    expect(s.getState().status).toBe('signed_out');
    expect(s.getState().loggedOut).toBe(true);
    expect(s.headers()).toEqual({});
  });
});
