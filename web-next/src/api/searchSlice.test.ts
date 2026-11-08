// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14 — клиент v2 к существующему слайсу search
// (GET /lore/slice/search?pattern=…). Отказы — словами: «нет прав» ≠ «ничего нет».
import { describe, expect, it, vi } from 'vitest';
import { fetchSearchSlice, SEARCH_TYPE_CAP } from './searchSlice';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('S4-14 · fetchSearchSlice', () => {
  it('ходит в /lore/slice/search с pattern и заголовками; строки без ref_id отбрасывает', async () => {
    const fetchImpl = vi.fn(async () => json(200, {
      rows: [
        { type: 'adr', ref_id: 'ADR-1', title: 'Палитра' },
        { type: 'task', ref_id: null, title: 'сирота' },
        { type: 'sprint', ref_id: 'SPRINT_X', title: null },
      ],
    }));
    const r = await fetchSearchSlice('пал итра', { fetchImpl, headers: () => ({ Authorization: 'Bearer t' }) });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/lore/slice/search?pattern=%D0%BF%D0%B0%D0%BB+%D0%B8%D1%82%D1%80%D0%B0');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect(r.rows).toEqual([
      { type: 'adr', ref_id: 'ADR-1', title: 'Палитра' },
      { type: 'sprint', ref_id: 'SPRINT_X', title: null },
    ]);
    expect(r.partial).toBe(false);
  });

  it('partial: сервер сказал truncated — или в каком-то типе упёрлись в потолок ветки', async () => {
    const many = Array.from({ length: SEARCH_TYPE_CAP }, (_, i) => ({ type: 'task', ref_id: `T-${i}`, title: 't' }));
    expect((await fetchSearchSlice('t', { fetchImpl: async () => json(200, { rows: many }) })).partial).toBe(true);
    expect((await fetchSearchSlice('t', { fetchImpl: async () => json(200, { rows: [], truncated: true }) })).partial).toBe(true);
    expect((await fetchSearchSlice('t', { fetchImpl: async () => json(200, { rows: [], truncated: 'unknown' }) })).partial).toBe(true);
  });

  it('403 SCOPE_EMPTY — «нет прав», а не пустая выдача', async () => {
    const p = fetchSearchSlice('x', { fetchImpl: async () => json(403, { error: 'SCOPE_EMPTY', detail: 'нет проектов' }) });
    await expect(p).rejects.toThrow(/403.*нет доступа/);
  });

  it('401 — нужен вход; 502 — сервер LORE недоступен; не-JSON — тоже отказ, а не «ничего»', async () => {
    await expect(fetchSearchSlice('x', { fetchImpl: async () => json(401, {}) })).rejects.toThrow(/401.*вход/);
    await expect(fetchSearchSlice('x', { fetchImpl: async () => new Response('<html>', { status: 502 }) })).rejects.toThrow(/502.*недоступен/);
    await expect(fetchSearchSlice('x', { fetchImpl: async () => new Response('<html>', { status: 200 }) })).rejects.toThrow(/не JSON/);
  });

  it('en: причины на английском', async () => {
    await expect(fetchSearchSlice('x', { lang: 'en', fetchImpl: async () => json(403, {}) })).rejects.toThrow(/403.*no access/);
  });

  it('400 BAD_PARAMS — показывает detail сервера', async () => {
    await expect(fetchSearchSlice('x', { fetchImpl: async () => json(400, { error: 'BAD_PARAMS', detail: 'pattern: bad value' }) }))
      .rejects.toThrow(/400.*pattern: bad value/);
  });
});
