// Realm — настройка среды, а не сборки (владелица 15.11.2026: «вынеси realm настройкой для каждой среды»).
// Повод — v1.17.21fix: фронт прода собран на препроде с VITE_OIDC_ISSUER=…/omilorePreprod, и вход на проде
// уходил в realm препрода. Теперь адрес входа берётся у бэкенда своей среды (GET /lore/auth/config);
// значение сборки — только запасной путь, если бэкенд не ответил.
import { describe, expect, it, vi } from 'vitest';
import { loadRuntimeAuthConfig, resolveOidc } from './runtimeAuthConfig';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const BUILD = { issuer: 'https://kc/realms/omilorePreprod', clientId: 'lore-app' };

describe('адрес входа своей среды', () => {
  it('бэкенд среды ответил — берётся его issuer, а не впечённый при сборке', async () => {
    const f = vi.fn(async () => json({ auth_enabled: true, issuer: 'https://kc/realms/omilore', client_id: 'lore-app' }));
    const rt = await loadRuntimeAuthConfig(f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith('/lore/auth/config', expect.objectContaining({ cache: 'no-store' }));
    expect(resolveOidc(BUILD, rt)).toEqual({ issuer: 'https://kc/realms/omilore', clientId: 'lore-app' });
  });

  it('бэкенд не ответил (сеть, 404 старого бэкенда) — запасной путь: значение сборки', async () => {
    const down = vi.fn(async () => { throw new TypeError('network'); });
    expect(resolveOidc(BUILD, await loadRuntimeAuthConfig(down as unknown as typeof fetch))).toEqual(BUILD);
    const old = vi.fn(async () => json({ error: 'UNKNOWN' }, 404));
    expect(resolveOidc(BUILD, await loadRuntimeAuthConfig(old as unknown as typeof fetch))).toEqual(BUILD);
  });

  it('issuer пустой (вход выключен на бэкенде) — не затирает значение сборки', async () => {
    const f = vi.fn(async () => json({ auth_enabled: false, issuer: null, client_id: 'lore-app' }));
    expect(resolveOidc(BUILD, await loadRuntimeAuthConfig(f as unknown as typeof fetch)).issuer).toBe(BUILD.issuer);
  });

  it('клиент по умолчанию — lore-app', () => {
    expect(resolveOidc({ issuer: 'x' }, null).clientId).toBe('lore-app');
  });
});
