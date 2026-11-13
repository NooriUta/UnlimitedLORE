// Общий вход приложений на kit (SPRINT_UXR_S3_V2_INFRA/S3-18).
//
// Зачем свой, а не «прочитать токен v1». LORE v2 живёт на своём origin
// (new.lore…), а localStorage привязан к origin: ключ `oidc.user:*`, который
// пишет вход v1 на lore…, на new.lore не виден. v2 без своего входа слал
// запросы без Authorization и получал 401 на всё (S3-18).
//
// Модель — та же, что у v1 (src/auth/session.ts, заморожен): Authorization Code
// + PKCE S256 в Keycloak, тихое продление, честные «не вошли» и «сессия
// истекла». Отличие — сессия здесь объект, а не модульное состояние: её можно
// создать в тесте с поддельным UserManager и без браузера.
//
// Правила:
//   - вход выключен (VITE_LORE_AUTH_ENABLED пусто) — поведение прежнее:
//     dev-роль X-Seer-Role, OIDC даже не создаётся;
//   - нет действующего токена — запрос НЕ уходит (без Authorization бэкенд
//     ответит 401, а экран нарисовал бы пустоту); нет сессии — ведём на вход;
//   - 401 от API — «сессия истекла», что бы ни думал клиент (протухший токен,
//     не сработавшее продление); на вход сами не уводим — на экране может быть
//     несохранённое, решает человек кнопкой «Войти снова».

/** Пользователь OIDC — подмножество User oidc-client-ts, которое нужно сессии. */
export interface OidcUserLike {
  access_token: string;
  /** Unix-секунды. */
  expires_at?: number;
  refresh_token?: string;
  profile?: Record<string, unknown>;
  state?: unknown;
}

/** Подмножество UserManager oidc-client-ts (боевой — oidc.ts, в тестах — подделка). */
export interface UserManagerLike {
  getUser(): Promise<OidcUserLike | null>;
  signinRedirect(args?: { state?: unknown; prompt?: string }): Promise<void>;
  signinRedirectCallback(url?: string): Promise<OidcUserLike>;
  signinSilent(): Promise<OidcUserLike | null>;
  signoutRedirect(): Promise<void>;
  removeUser(): Promise<void>;
  events: {
    addUserLoaded(cb: (u: OidcUserLike) => void): unknown;
    addUserUnloaded(cb: () => void): unknown;
    addSilentRenewError(cb: (e: Error) => void): unknown;
  };
}

export type AuthStatus = 'disabled' | 'loading' | 'signed_in' | 'signed_out' | 'expired' | 'error';

export interface AuthUserInfo {
  name: string | null;
  sub: string | null;
  /** Unix-секунды окончания токена. */
  expiresAt: number | null;
}

export interface AuthState {
  status: AuthStatus;
  user: AuthUserInfo | null;
  /** expired: сессия была на этой странице и отвалилась (экран остаётся под плашкой). */
  interrupted: boolean;
  /** signed_out: вышли сами — на вход сразу не уводим. */
  loggedOut: boolean;
  error?: unknown;
}

export interface LocationLike {
  href: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

export interface AuthSessionOptions {
  enabled: boolean;
  /** Создать менеджер OIDC (лениво: при выключенном входе не создаётся вовсе). */
  manager?: () => UserManagerLike;
  /** Путь redirect_uri (callback-маршрут); по умолчанию «/». */
  redirectPath?: string;
  location?: () => LocationLike;
  replaceUrl?: (url: string) => void;
  /** Часы, мс (тесты). */
  now?: () => number;
  /** Заголовки при выключенном входе (у LORE — dev-роль, как в v1). Нет — без заголовков. */
  devHeaders?: Record<string, string>;
}

/** Запрос не отправлен: нет действующего токена. status 401 — kit classifyError рисует сбой входа. */
export class AuthRequiredError extends Error {
  readonly status = 401;
  readonly code = 'UNAUTHENTICATED';
  constructor(message = 'нет действующей сессии входа — запрос не отправлен') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AuthSession {
  readonly enabled: boolean;
  getState(): AuthState;
  subscribe(fn: () => void): () => void;
  /** Поднять сессию: callback, сохранённый пользователь, тихое продление. Один раз до рендера. */
  init(): Promise<void>;
  /** Заголовки входа сейчас: Bearer | dev-роль | ничего. */
  headers(): Record<string, string>;
  /** fetch с входом: Bearer, отказ без токена, 401 → expired. */
  wrapFetch(base?: FetchFn): FetchFn;
  login(returnTo?: string): Promise<void>;
  logout(): Promise<void>;
  /** Бэкенд сказал 401 — сессия недействительна. */
  expire(): void;
}

/** Своих dev-заголовков у kit нет (K-14): какие слать при выключенном входе — решает приложение. */
const NO_DEV_HEADERS: Record<string, string> = {};

function browserLocation(): LocationLike {
  const l = globalThis.location;
  return { href: l.href, origin: l.origin, pathname: l.pathname, search: l.search, hash: l.hash };
}

function browserReplace(url: string): void {
  globalThis.history?.replaceState(null, '', url);
}

const normPath = (p: string) => (p.replace(/\/+$/, '') || '/');

/** Возврат из Keycloak: путь redirect_uri + state + (code | error). */
export function isCallbackUrl(url: URL | LocationLike, redirectPath: string): boolean {
  if (normPath(url.pathname) !== normPath(redirectPath)) return false;
  const q = new URLSearchParams(url.search);
  return q.has('state') && (q.has('code') || q.has('error'));
}

/** Возврат только на свой путь: «/…», но не «//host» — иначе state стал бы открытым редиректом. */
function safeReturn(state: unknown, fallback: string): string {
  return typeof state === 'string' && state.startsWith('/') && !state.startsWith('//') ? state : fallback;
}

function info(u: OidcUserLike): AuthUserInfo {
  const p = u.profile ?? {};
  const pick = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null);
  return {
    name: pick('preferred_username') ?? pick('name') ?? pick('sub'),
    sub: pick('sub'),
    expiresAt: typeof u.expires_at === 'number' ? u.expires_at : null,
  };
}

export function createAuthSession(opts: AuthSessionOptions): AuthSession {
  const enabled = opts.enabled;
  const now = opts.now ?? Date.now;
  const where = opts.location ?? browserLocation;
  const replaceUrl = opts.replaceUrl ?? browserReplace;
  const redirectPath = opts.redirectPath ?? '/';
  const devHeaders = opts.devHeaders ?? NO_DEV_HEADERS;

  let mgr: UserManagerLike | null = null;
  let user: OidcUserLike | null = null;
  let state: AuthState = { status: enabled ? 'loading' : 'disabled', user: null, interrupted: false, loggedOut: false };
  let renewing: Promise<OidcUserLike | null> | null = null;
  // S4-34: oidc-client-ts шлёт userLoaded ВНУТРИ signinRedirectCallback, до возврата.
  // Пока идёт callback, событие вход не объявляет: иначе AuthGate нарисует App на
  // адресе callback («/»), а возврат на исходный путь придёт уже после рендера.
  let inCallback = false;
  const listeners = new Set<() => void>();

  const set = (next: Partial<AuthState>) => {
    state = { ...state, ...next };
    listeners.forEach(fn => fn());
  };

  const valid = (u: OidcUserLike | null): u is OidcUserLike =>
    !!u && !!u.access_token && (typeof u.expires_at !== 'number' || u.expires_at > now() / 1000);

  const signedIn = (u: OidcUserLike) => {
    user = u;
    set({ status: 'signed_in', user: info(u), interrupted: false, loggedOut: false, error: undefined });
  };

  const manager = (): UserManagerLike => {
    if (mgr) return mgr;
    if (!opts.manager) throw new Error('вход включён, но менеджер OIDC не задан (VITE_OIDC_ISSUER?)');
    mgr = opts.manager();
    mgr.events.addUserLoaded(u => { if (!inCallback && valid(u)) signedIn(u); });
    mgr.events.addUserUnloaded(() => {
      user = null;
      if (state.status === 'signed_in') set({ status: 'signed_out', user: null });
    });
    // Автопродление oidc-client-ts оборвалось. Пока токен жив — работаем дальше
    // (следующий запрос попробует продлить сам); протух — честно «истекла».
    mgr.events.addSilentRenewError(() => { if (!valid(user)) expire(); });
    return mgr;
  };

  function expire(): void {
    if (!enabled) return;
    const interrupted = state.status === 'signed_in' || (state.status === 'expired' && state.interrupted);
    user = null;
    if (state.status === 'expired' && state.interrupted === interrupted) return;
    set({ status: 'expired', user: null, interrupted, loggedOut: false });
  }

  /** Тихое продление — одно на все одновременные запросы. */
  const renew = (): Promise<OidcUserLike | null> => {
    if (!renewing) {
      renewing = manager().signinSilent()
        .then(u => (valid(u) ? u : null), () => null)
        .finally(() => { renewing = null; });
    }
    return renewing;
  };

  const currentPath = () => {
    const l = where();
    return `${l.pathname}${l.search}${l.hash}`;
  };

  async function login(returnTo?: string): Promise<void> {
    await manager().signinRedirect({ state: returnTo ?? currentPath() });
  }

  /** Действующий токен или null; протухший пробуем продлить. */
  async function ensureToken(): Promise<string | null> {
    if (valid(user)) return user.access_token;
    if (user && state.status === 'signed_in') {
      const u = await renew();
      if (u) { signedIn(u); return u.access_token; }
    }
    return null;
  }

  return {
    enabled,
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    async init() {
      if (!enabled) { set({ status: 'disabled' }); return; }
      const l = where();
      try {
        if (isCallbackUrl(l, redirectPath)) {
          inCallback = true;
          let u: OidcUserLike;
          try { u = await manager().signinRedirectCallback(l.href); } finally { inCallback = false; }
          replaceUrl(safeReturn(u.state, redirectPath));
          signedIn(u);
          return;
        }
        let u = await manager().getUser();
        // Сохранённый, но протухший пользователь — ещё не «вошли» (урок v1 AL-69:
        // приняли протухшего за вход — белый экран из 401). Сначала продление.
        if (u && !valid(u)) {
          user = u;
          u = await renew();
          if (!u) { user = null; set({ status: 'expired', user: null, interrupted: false }); return; }
        }
        if (u) signedIn(u);
        else { user = null; set({ status: 'signed_out', user: null }); }
      } catch (error) {
        user = null;
        set({ status: 'error', user: null, error });
      }
    },

    headers(): Record<string, string> {
      if (!enabled) return { ...devHeaders };
      return valid(user) ? { Authorization: `Bearer ${user.access_token}` } : {};
    },

    wrapFetch(base?: FetchFn): FetchFn {
      const doFetch: FetchFn = base ?? ((i, init) => globalThis.fetch(i, init));
      return async (input, init) => {
        const headers = new Headers(init?.headers);
        if (!enabled) {
          for (const [k, v] of Object.entries(devHeaders)) if (!headers.has(k)) headers.set(k, v);
          return doFetch(input, { ...init, headers });
        }
        const token = await ensureToken();
        if (!token) {
          // Не вошли — ведём на вход; сессия отвалилась — ждём «Войти снова».
          if (state.status === 'signed_out' && !state.loggedOut) void login().catch(() => {});
          else if (state.status === 'signed_in') expire();
          throw new AuthRequiredError();
        }
        headers.set('Authorization', `Bearer ${token}`);
        const res = await doFetch(input, { ...init, headers });
        if (res.status === 401) expire();
        return res;
      };
    },

    login,

    async logout() {
      if (!enabled) return;
      const m = manager();
      try {
        await m.signoutRedirect();
      } catch {
        // Keycloak недоступен: молча выйти из функции нельзя — кнопка «Выйти»
        // выглядела бы сломанной. Гасим сессию хотя бы локально.
        await m.removeUser().catch(() => {});
        user = null;
        set({ status: 'signed_out', user: null, loggedOut: true, interrupted: false });
      }
    },

    expire,
  };
}
