import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLoreSlice, LoreHttpError, LoreUpstreamError, LoreDisabledError } from './lore';
import { fetchLoreSliceMeta, parseSliceMeta } from './loreSliceMeta';

// SPRINT_UXR_S1_HONEST_API/S1-02: метаданные полноты в ответе слайса.
//
// Было: fetchLoreSlice отдаёт только body.rows, а бэкенд уже сообщает
// truncated/limit/hint, scope и page.warning (AidaLoreResource.sliceBody,
// SlicePage.apply). Экран не может отличить «всё» от «первые N» и «пусто» от
// «вне скоупа». Новый fetchLoreSliceMeta отдаёт {rows, fetchedAt, scope,
// truncated, warnings}; старый fetchLoreSlice обязан остаться прежним.

function mockFetch(status: number, body: unknown, contentType = 'application/json') {
  vi.stubGlobal('location', { origin: 'http://lore.test' });
  const fn = vi.fn().mockResolvedValue({
    ok: status < 300, status, statusText: '',
    headers: { get: () => contentType },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

const NOW = new Date('2026-11-07T10:00:00.000Z');

describe('parseSliceMeta: нормализация тела слайса', () => {
  it('полная выдача без скоупа — truncated=false, scope=null, warnings пуст', () => {
    const m = parseSliceMeta<{ id: string }>({ rows: [{ id: 'A' }] }, NOW);
    expect(m).toEqual({
      rows: [{ id: 'A' }], fetchedAt: '2026-11-07T10:00:00.000Z',
      scope: null, truncated: false, limit: null, page: null, outsideScope: null, warnings: [],
    });
  });

  it('усечение сервером — truncated=true, limit и hint в warnings', () => {
    const m = parseSliceMeta({ rows: [], truncated: true, limit: 500, hint: 'обрезано на 500' }, NOW);
    expect(m.truncated).toBe(true);
    expect(m.limit).toBe(500);
    expect(m.warnings).toEqual(['обрезано на 500']);
  });

  it('усечение «неизвестно» не схлопывается в false', () => {
    const m = parseSliceMeta({ rows: [], truncated: 'unknown', hint: 'проверить нечем' }, NOW);
    expect(m.truncated).toBe('unknown');
    expect(m.warnings).toEqual(['проверить нечем']);
  });

  it('скоуп и «вне скоупа» передаются, причина — в warnings', () => {
    const m = parseSliceMeta({
      rows: [],
      scope: { applied: true, projects: 2, note: 'сужено' },
      outside_scope: { id: 'X', verdict: 'outside_scope', reason: 'есть, но вне ваших проектов' },
    }, NOW);
    expect(m.scope).toEqual({ applied: true, projects: 2, note: 'сужено' });
    expect(m.outsideScope).toEqual({ id: 'X', verdict: 'outside_scope', reason: 'есть, но вне ваших проектов' });
    expect(m.warnings).toEqual(['есть, но вне ваших проектов']);
  });

  it('страница: has_more и page.warning доходят', () => {
    const m = parseSliceMeta({
      rows: [], page: { limit: 10, offset: 0, total: 0, has_more: false, fields: ['x'], warning: '0 rows: fields [x]' },
    }, NOW);
    expect(m.page).toMatchObject({ limit: 10, offset: 0, total: 0, has_more: false });
    expect(m.warnings).toEqual(['0 rows: fields [x]']);
  });

  it('тело без rows — пустой массив, а не падение', () => {
    expect(parseSliceMeta({}, NOW).rows).toEqual([]);
  });
});

describe('fetchLoreSliceMeta: транспорт', () => {
  it('отдаёт метаданные вместе со строками и тем же URL, что fetchLoreSlice', async () => {
    const fn = mockFetch(200, { rows: [{ id: 'A' }], truncated: true, limit: 500, hint: 'h' });
    const m = await fetchLoreSliceMeta<{ id: string }>('sprints', { status: 'open' });
    expect(m.rows).toEqual([{ id: 'A' }]);
    expect(m.truncated).toBe(true);
    expect(typeof m.fetchedAt).toBe('string');
    expect(Number.isNaN(Date.parse(m.fetchedAt))).toBe(false);
    expect(fn.mock.calls[0][0]).toBe('http://lore.test/lore/slice/sprints?status=open');
  });

  it('ошибки — те же классы, что у fetchLoreSlice (не «пусто»)', async () => {
    mockFetch(403, '<html>forbidden</html>', 'text/html');
    await expect(fetchLoreSliceMeta('sprints')).rejects.toBeInstanceOf(LoreHttpError);
    mockFetch(502, '<html>bad</html>', 'text/html');
    await expect(fetchLoreSliceMeta('sprints')).rejects.toBeInstanceOf(LoreUpstreamError);
    mockFetch(404, { error: 'LORE_DISABLED' });
    await expect(fetchLoreSliceMeta('sprints')).rejects.toBeInstanceOf(LoreDisabledError);
    mockFetch(403, { error: 'SCOPE_EMPTY', detail: 'нет проектов' });
    const e = await fetchLoreSliceMeta('sprints').catch(x => x);
    expect(e).toBeInstanceOf(LoreHttpError);
    expect((e as Error).message).toBe('403 SCOPE_EMPTY: нет проектов');
  });

  it('старый fetchLoreSlice не изменился — по-прежнему голый массив rows', async () => {
    mockFetch(200, { rows: [{ id: 'A' }], truncated: true, limit: 500 });
    await expect(fetchLoreSlice('sprints')).resolves.toEqual([{ id: 'A' }]);
  });
});
