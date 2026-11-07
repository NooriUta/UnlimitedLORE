// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04 — клиент v2 к /lore/slice/*: свой, не
// src/api v1 (заморожен). Тело слайса с метаданными полноты S1 отдаётся как
// есть; ошибка несёт HTTP-статус, чтобы kit различил «нет прав» и «сбой».
import { describe, expect, it, vi } from 'vitest';
import { classifyError } from '@seidr/kit';
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
    expect((init.headers as Record<string, string>)['X-Seer-Role']).toBe('admin');
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

  it('с включённым входом — Bearer из сохранённой OIDC-сессии; протухшая — без заголовка', async () => {
    const store = new Map<string, string>([
      ['oidc.user:https://kc/realms/x:lore-app', JSON.stringify({ access_token: 'T', expires_at: 4_000_000_000 })],
    ]);
    const storage = { length: store.size, key: (i: number) => [...store.keys()][i] ?? null, getItem: (k: string) => store.get(k) ?? null };
    const fetchImpl = vi.fn(async () => json(200, { rows: [] }));
    await fetchSlice('adrs', undefined, { fetchImpl, base: 'http://h', authEnabled: true, storage, now: () => 1_000_000_000_000 });
    let init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer T');
    expect((init.headers as Record<string, string>)['X-Seer-Role']).toBeUndefined();

    await fetchSlice('adrs', undefined, { fetchImpl, base: 'http://h', authEnabled: true, storage, now: () => 5_000_000_000_000 });
    init = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
