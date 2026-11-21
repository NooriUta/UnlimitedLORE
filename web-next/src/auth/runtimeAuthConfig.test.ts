// Настройки входа — настройка ЗАПУСКА, а не сборки (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE,
// владелица: «гвозди убери из инсталлятора»; правило — в образе и бандле нет ни одного нашего имени хоста).
// Повод — v1.17.21fix: фронт прода собран на препроде с VITE_OIDC_ISSUER=…/omilorePreprod, и вход на проде
// уходил в realm препрода; чужая установка с нашим образом шла бы в наш Keycloak.
//
// Порядок: /config.json (собран nginx образа из env контейнера при старте) → /lore/auth/config (бэкенд своей
// среды) → значения сборки ТОЛЬКО в dev. Ничего не пришло — «вход не настроен», а не наш адрес.
import { describe, expect, it, vi } from 'vitest';
import { AuthNotConfiguredError } from '@seidr/kit/auth';
import { loadFrontConfig, loadRuntimeAuthConfig, resolveAuth } from './runtimeAuthConfig';
import { oidcTarget } from './session';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const BUILD = { enabled: true, issuer: 'https://kc/realms/omilorePreprod', clientId: 'lore-app' };
const asFetch = (f: unknown) => f as typeof fetch;

describe('SELF-PROVISION · /config.json — настройки входа из env контейнера', () => {
  it('issuer берётся из /config.json, а не из import.meta.env сборки', async () => {
    const f = vi.fn(async () => json({ auth_enabled: 'true', oidc_issuer: 'https://auth.example.org/realms/x', oidc_client_id: 'web' }));
    const front = await loadFrontConfig(asFetch(f));
    expect(f).toHaveBeenCalledWith('/config.json', expect.objectContaining({ cache: 'no-store' }));
    expect(resolveAuth({ front, backend: null, build: BUILD, dev: false }))
      .toEqual({ enabled: true, issuer: 'https://auth.example.org/realms/x', clientId: 'web' });
    // и в dev значение сборки не перебивает настройку запуска
    expect(resolveAuth({ front, backend: null, build: BUILD, dev: true }).issuer).toBe('https://auth.example.org/realms/x');
  });

  it('пустые значения envsubst («») — «не задано», а не «выключено»: решает следующий источник', async () => {
    const f = vi.fn(async () => json({ auth_enabled: '', oidc_issuer: '', oidc_client_id: '' }));
    const front = await loadFrontConfig(asFetch(f));
    const backend = { authEnabled: true, issuer: 'https://kc/realms/omilore', clientId: 'lore-app' };
    expect(resolveAuth({ front, backend, build: BUILD, dev: false }))
      .toEqual({ enabled: true, issuer: 'https://kc/realms/omilore', clientId: 'lore-app' });
  });

  it('auth_enabled=false в /config.json — вход выключен', async () => {
    const front = await loadFrontConfig(asFetch(vi.fn(async () => json({ auth_enabled: 'false' }))));
    expect(resolveAuth({ front, backend: null, build: BUILD, dev: false }).enabled).toBe(false);
  });

  it('/config.json нет (404, сеть, не JSON) — null, решает бэкенд своей среды', async () => {
    expect(await loadFrontConfig(asFetch(vi.fn(async () => json({}, 404))))).toBeNull();
    expect(await loadFrontConfig(asFetch(vi.fn(async () => { throw new TypeError('network'); })))).toBeNull();
    // SPA-фолбэк nginx отдаёт index.html с кодом 200 — это не конфиг
    expect(await loadFrontConfig(asFetch(vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))))).toBeNull();
    const backend = await loadRuntimeAuthConfig(asFetch(vi.fn(async () => json({ auth_enabled: true, issuer: 'https://kc/realms/omilore', client_id: 'lore-app' }))));
    expect(resolveAuth({ front: null, backend, build: BUILD, dev: false }))
      .toEqual({ enabled: true, issuer: 'https://kc/realms/omilore', clientId: 'lore-app' });
  });

  it('прод: ни /config.json, ни бэкенд не сказали — значения сборки НЕ берутся, адреса нет («вход не настроен»)', () => {
    const r = resolveAuth({ front: null, backend: null, build: BUILD, dev: false });
    expect(r.issuer).toBeUndefined();
    expect(r.enabled).toBe(true);
  });

  it('dev (vite serve): значения сборки — запасной путь', () => {
    expect(resolveAuth({ front: null, backend: null, build: BUILD, dev: true })).toEqual(BUILD);
    expect(resolveAuth({ front: null, backend: null, build: { enabled: false }, dev: true }).enabled).toBe(false);
  });

  it('адреса нет — сессия получает AuthNotConfiguredError («вход не настроен»), а не наш адрес', () => {
    expect(() => oidcTarget(null)).toThrow(AuthNotConfiguredError);
    expect(() => oidcTarget(resolveAuth({ front: null, backend: null, build: BUILD, dev: false }))).toThrow(AuthNotConfiguredError);
    expect(oidcTarget({ enabled: true, issuer: 'https://auth.example.org/realms/x', clientId: 'web' }))
      .toEqual({ issuer: 'https://auth.example.org/realms/x', clientId: 'web' });
  });

  it('клиент по умолчанию — lore-app', () => {
    expect(resolveAuth({ front: { issuer: 'x' }, backend: null, build: {}, dev: false }).clientId).toBe('lore-app');
  });
});
