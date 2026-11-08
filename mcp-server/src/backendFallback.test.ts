import { describe, expect, it, vi } from 'vitest';
import { loreFetch } from './backend.js';

// SPRINT_UXR_S2_GRAPH_MEMORY/S2-08: прямой адрес бэкенда (Traefik /_backend) — основной,
// :4400 nginx фронта — запасной. Переход на запасной только там, где запрос
// до бэкенда заведомо НЕ дошёл: иначе неидемпотентная запись задвоится.

function netError(code: string, message = 'boom'): TypeError {
  const e = new TypeError('fetch failed');
  (e as { cause?: unknown }).cause = Object.assign(new Error(message), { code });
  return e;
}

const bases = {
  primary: 'https://lore.example/_backend',
  fallback: 'http://192.0.2.1:4400',
};

describe('запасной адрес бэкенда', () => {
  it('соединение с основным не установлено → тот же запрос уходит на запасной', async () => {
    const ok = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const f = vi.fn()
      .mockRejectedValueOnce(netError('ENOTFOUND'))
      .mockRejectedValueOnce(netError('ENOTFOUND'))
      .mockResolvedValueOnce(ok);
    const res = await loreFetch('POST /lore/doc', `${bases.primary}/lore/doc?x=1`, { method: 'POST' }, f as typeof fetch, bases);
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls[2][0]).toBe(`${bases.fallback}/lore/doc?x=1`);
    expect(f.mock.calls[2][1].method).toBe('POST');
  });

  it('ошибка TLS у основного (запрос не ушёл) → запасной', async () => {
    const ok = new Response('{}', { status: 200 });
    const f = vi.fn()
      .mockRejectedValueOnce(netError('ERR_TLS_CERT_ALTNAME_INVALID'))
      .mockResolvedValueOnce(ok);
    const res = await loreFetch('GET /lore/version', `${bases.primary}/lore/version`, {}, f as typeof fetch, bases);
    expect(res.status).toBe(200);
    expect(f.mock.calls[1][0]).toBe(`${bases.fallback}/lore/version`);
  });

  it('маршрута нет и ответил SPA фронта (text/html) → запасной: до бэкенда запрос не дошёл', async () => {
    const spa = new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const ok = new Response('{"v":1}', { status: 200, headers: { 'content-type': 'application/json' } });
    const f = vi.fn().mockResolvedValueOnce(spa).mockResolvedValueOnce(ok);
    const res = await loreFetch('GET /lore/version', `${bases.primary}/lore/version`, {}, f as typeof fetch, bases);
    expect(await res.text()).toBe('{"v":1}');
    expect(f.mock.calls[1][0]).toBe(`${bases.fallback}/lore/version`);
  });

  it('обрыв открытого соединения на записи НЕ уходит на запасной — запрос мог дойти', async () => {
    const f = vi.fn().mockRejectedValue(netError('ECONNRESET', 'other side closed'));
    await expect(
      loreFetch('POST /lore/doc', `${bases.primary}/lore/doc`, { method: 'POST' }, f as typeof fetch, bases),
    ).rejects.toThrow(/ECONNRESET/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('ответ бэкенда (401 JSON) с основного отдаётся как есть, без запасного', async () => {
    const r401 = new Response('{"error":"unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } });
    const f = vi.fn().mockResolvedValueOnce(r401);
    const res = await loreFetch('GET /lore/version', `${bases.primary}/lore/version`, {}, f as typeof fetch, bases);
    expect(res.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('запасной не задан → прежнее поведение: ошибка с причиной', async () => {
    const f = vi.fn().mockRejectedValue(netError('ECONNREFUSED'));
    await expect(
      loreFetch('GET /lore/version', `${bases.primary}/lore/version`, {}, f as typeof fetch, { primary: bases.primary }),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('оба недоступны → ошибка называет и основной, и запасной', async () => {
    const f = vi.fn().mockRejectedValue(netError('ECONNREFUSED'));
    await expect(
      loreFetch('GET /lore/version', `${bases.primary}/lore/version`, {}, f as typeof fetch, bases),
    ).rejects.toThrow(/запасной/);
  });
});
