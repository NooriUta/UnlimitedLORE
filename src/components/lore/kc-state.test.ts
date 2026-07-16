import { describe, expect, it } from 'vitest';
import { loadKc, loadKcObj } from './kc-state';

// AL-47 (регрессия AL-31): «пусто», «отказано», «мост не настроен» и «сеть умерла» —
// ЧЕТЫРЕ разных состояния. До фикса 403/503 рисовали тот же экран, что и пустой
// realm («заведите первого»), — противоположные ситуации выглядели одинаково.

const resp = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

describe('loadKc — разбор исходов KC-моста', () => {
  it('200 с пустым массивом → ok/rows=[] (реально пустой realm, НЕ ошибка)', async () => {
    const s = await loadKc('/lore/kc/users', resp(200, []));
    expect(s).toEqual({ k: 'ok', rows: [] });
  });

  it('200 со списком → ok/rows', async () => {
    const s = await loadKc<{ id: string }>('/lore/kc/users', resp(200, [{ id: 'u1' }]));
    expect(s.k).toBe('ok');
    if (s.k === 'ok') expect(s.rows).toHaveLength(1);
  });

  it('403 → forbidden (записи могут существовать — это не пустота)', async () => {
    const s = await loadKc('/lore/kc/users', resp(403, { error: 'FORBIDDEN', detail: 'admin role required' }));
    expect(s).toEqual({ k: 'forbidden' });
  });

  it('503 → off с причиной из detail (мост не настроен)', async () => {
    const s = await loadKc('/lore/kc/users', resp(503, { error: 'KC_NOT_CONFIGURED', detail: 'KC_ADMIN_CLIENT_SECRET unset' }));
    expect(s).toEqual({ k: 'off', detail: 'KC_ADMIN_CLIENT_SECRET unset' });
  });

  it('503 без тела → off с фолбэк-причиной, не краш', async () => {
    const broken = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    const s = await loadKc('/lore/kc/users', broken);
    expect(s).toEqual({ k: 'off', detail: 'not configured' });
  });

  it('502 → error с HTTP-кодом', async () => {
    const s = await loadKc('/lore/kc/users', resp(502, {}));
    expect(s).toEqual({ k: 'error', detail: 'HTTP 502' });
  });

  it('сеть упала → error с сообщением, не unhandled rejection', async () => {
    const dead = (async () => { throw new Error('fetch failed'); }) as unknown as typeof fetch;
    const s = await loadKc('/lore/kc/users', dead);
    expect(s).toEqual({ k: 'error', detail: 'fetch failed' });
  });
});

describe('loadKcObj — одиночные объекты (preflight/denials)', () => {
  it('200 → объект', async () => {
    expect(await loadKcObj('/lore/kc/auth-preflight', resp(200, { admin_count: 0 }))).toEqual({ admin_count: 0 });
  });
  it('не-ok и сеть → null (UI показывает «недоступно», не падает)', async () => {
    expect(await loadKcObj('/x', resp(403))).toBeNull();
    const dead = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await loadKcObj('/x', dead)).toBeNull();
  });
});
