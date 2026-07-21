// Тесты пути с ВКЛЮЧЁННОЙ аутентификацией (AL-75).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Остальные тесты в src/auth написаны как
// `AUTH_ENABLED ? ожидаемоеА : ожидаемоеБ` и всегда идут по ветке «выключено»:
// в тестовой сборке флаг не задан. То есть весь путь с токенами — ровно тот,
// что уронил прод 2026-07-21, — не проверялся автоматически вообще.
//
// Обнаружилось случайно: временный .env.local с VITE_LORE_AUTH_ENABLED=true
// (заводился, чтобы посмотреть экран входа) сделал флаг истинным, и три теста
// сразу покраснели. Vitest читает те же .env, что и Vite.
//
// Здесь флаг взводится ЯВНО через stubEnv, а oidc-client-ts подменяется — иначе
// проверить нечего: настоящий UserManager полез бы в сеть и в localStorage.
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Управляет поведением поддельного UserManager внутри теста. */
const kc = {
  storedUser: null as unknown,
  silentRenewFails: true,
  signoutFails: false,
  removeUserCalled: false,
};

vi.mock('oidc-client-ts', () => {
  class UserManager {
    events = {
      addUserLoaded: () => {},
      addUserUnloaded: () => {},
      addSilentRenewError: () => {},
    };
    async getUser() { return kc.storedUser; }
    async signinSilent() {
      if (kc.silentRenewFails) throw new Error('silent renew failed');
      return kc.storedUser;
    }
    async signinRedirect() {}
    async signoutRedirect() { if (kc.signoutFails) throw new Error('keycloak unreachable'); }
    async removeUser() { kc.removeUserCalled = true; }
  }
  class WebStorageStateStore {}
  return { UserManager, WebStorageStateStore };
});

/** Свежая копия модуля с включённым auth: AUTH_ENABLED читается на загрузке. */
async function loadSession() {
  vi.resetModules();
  vi.stubEnv('VITE_LORE_AUTH_ENABLED', 'true');
  vi.stubEnv('VITE_OIDC_ISSUER', 'https://kc.example/realms/omilore');
  // Модуль живёт в браузере: getUserManager() берёт location.origin, а хранилище
  // сессии — window.localStorage. В node-окружении их нет.
  vi.stubGlobal('location', { origin: 'https://lore.example', pathname: '/', search: '' });
  vi.stubGlobal('window', { localStorage: {} });
  return import('./session');
}

const validUser = {
  expired: false,
  access_token: 'ACCESS-TOKEN',
  profile: { preferred_username: 'omiloreadmin', seer_roles: ['admin'] },
};

beforeEach(() => {
  kc.storedUser = null;
  kc.silentRenewFails = true;
  kc.signoutFails = false;
  kc.removeUserCalled = false;
});

describe('authHeaders при включённом auth', () => {
  it('без действительного токена НЕ шлёт X-Seer-Role — иначе выключенная сессия осталась бы админом', async () => {
    const s = await loadSession();
    await s.initSession();
    // Это главный инвариант всего перехода на OIDC. С выключенным auth функция
    // отдаёт { 'X-Seer-Role': 'admin' }; если бы она делала это и с включённым,
    // протухшая сессия молча сохраняла бы админские права.
    expect(s.authHeaders()).toEqual({});
  });

  it('с действительным токеном шлёт Bearer', async () => {
    kc.storedUser = validUser;
    const s = await loadSession();
    await s.initSession();
    expect(s.authHeaders()).toEqual({ Authorization: 'Bearer ACCESS-TOKEN' });
  });
});

describe('initSession с протухшим пользователем', () => {
  it('не считает его вошедшим, когда продлить не удалось (сердцевина AL-69)', async () => {
    kc.storedUser = { ...validUser, expired: true };
    kc.silentRenewFails = true;
    const s = await loadSession();
    await s.initSession();
    // Раньше getUser() отдавал протухшего, AuthGate видел `!= null` и считал
    // вход состоявшимся: приложение рендерилось, а каждый запрос получал 401.
    expect(s.hasValidSession()).toBe(false);
    expect(s.authHeaders()).toEqual({});
  });

  it('взводит признак «сессия потеряна» — экран входа обязан назвать причину', async () => {
    kc.storedUser = { ...validUser, expired: true };
    const s = await loadSession();
    await s.initSession();
    expect(s.wasSessionLost()).toBe(true);
  });

  it('успешное молчаливое продление возвращает сессию и НЕ помечает её потерянной', async () => {
    kc.storedUser = { ...validUser, expired: true };
    kc.silentRenewFails = false;
    const s = await loadSession();
    // signinSilent отдаёт того же пользователя; делаем его действительным, как
    // сделал бы настоящий KC, выдав новый токен.
    kc.storedUser = validUser;
    await s.initSession();
    expect(s.hasValidSession()).toBe(true);
    expect(s.wasSessionLost()).toBe(false);
  });
});

describe('getRole при включённом auth', () => {
  it('берёт роль из claim seer_roles, а не из dev-конфига', async () => {
    kc.storedUser = { ...validUser, profile: { seer_roles: ['super-admin'] } };
    const s = await loadSession();
    await s.initSession();
    expect(s.getRole()).toBe('superadmin');
  });

  it('без сессии роль viewer — не admin по умолчанию', async () => {
    const s = await loadSession();
    await s.initSession();
    expect(s.getRole()).toBe('viewer');
    expect(s.isAdmin()).toBe(false);
  });
});

describe('logout', () => {
  it('сбрасывает признак потери — уйти самому и быть выброшенным это разное', async () => {
    kc.storedUser = { ...validUser, expired: true };
    const s = await loadSession();
    await s.initSession();
    expect(s.wasSessionLost()).toBe(true);   // сначала выбросило
    await s.logout();                        // потом ушли сами
    // Иначе экран входа сказал бы «Сессия истекла» и напугал бы несуществующей
    // потерей несохранённого.
    expect(s.wasSessionLost()).toBe(false);
  });

  it('при недоступном Keycloak гасит сессию локально, а не молчит', async () => {
    kc.storedUser = validUser;
    kc.signoutFails = true;
    const s = await loadSession();
    await s.initSession();
    expect(s.hasValidSession()).toBe(true);
    await s.logout();
    // Кнопка «Выйти» без видимого результата читается как «не работает», и
    // человек остаётся с правами, от которых пытался избавиться.
    expect(kc.removeUserCalled).toBe(true);
    expect(s.hasValidSession()).toBe(false);
    expect(s.authHeaders()).toEqual({});
  });
});
