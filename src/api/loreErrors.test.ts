import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeLoreError, fetchLoreSlice, fetchSectionCount, loreMutate, LORE_TIMEOUT_MS,
  LoreConflictError, LoreDisabledError, LoreHttpError, LoreNotFoundError, LoreUpstreamError,
} from './lore';

// SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-07: ошибка ≠ «пусто», неудачное сохранение видно.
//
// Было: любой ответ с не-JSON телом (403 от прокси, 404 HTML) становился
// LoreUpstreamError, и LorePage заменял ВСЮ страницу на «LORE недоступен» —
// даже если упало одно сохранение. Остальные ошибки handleFetchError глушил
// молча («swallow other errors — they show in component empty-states»), и
// экран рисовал «пусто». Правило: «недоступен» — только когда сервер правда
// недоступен (502/503/504, сеть); всё прочее — ошибка с кодом, которую видно.

function mockFetch(status: number, body: unknown, contentType = 'application/json') {
  vi.stubGlobal('location', { origin: 'http://lore.test' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status < 300, status, statusText: '',
    headers: { get: () => contentType },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('транспорт LORE: какая ошибка какой', () => {
  it('403 с HTML-телом от прокси — ошибка с кодом 403, а не «LORE недоступен»', async () => {
    mockFetch(403, '<html>forbidden</html>', 'text/html');
    const e = await fetchLoreSlice('sprints').catch(x => x);
    expect(e).toBeInstanceOf(LoreHttpError);
    expect(e).not.toBeInstanceOf(LoreUpstreamError);
    expect((e as LoreHttpError).status).toBe(403);
  });

  it('502/503/504 с HTML — это и есть «недоступен»', async () => {
    for (const s of [502, 503, 504]) {
      mockFetch(s, '<html>bad gateway</html>', 'text/html');
      await expect(fetchLoreSlice('sprints')).rejects.toBeInstanceOf(LoreUpstreamError);
    }
  });

  it('500 с JSON — ошибка с кодом и текстом сервера, формат сообщения прежний', async () => {
    mockFetch(500, { error: 'SLICE_FAILED', detail: 'boom' });
    const e = await fetchLoreSlice('sprints').catch(x => x);
    expect(e).toBeInstanceOf(LoreHttpError);
    expect((e as LoreHttpError).status).toBe(500);
    expect((e as Error).message).toBe('500 SLICE_FAILED: boom');
  });

  // SPRINT_UXR_S1_HONEST_API/S1-03 (B-05): «база лежит» ≠ «запрос упал».
  // Сервер отдаёт оба как 502, различает код: LORE_UPSTREAM — до базы не
  // достучались (уровень страницы), LORE_QUERY_FAILED — упал один запрос
  // (уровень блока; остальные блоки страницы живы).
  it('502 LORE_QUERY_FAILED — ошибка блока, а не «LORE недоступен» на всю страницу', async () => {
    mockFetch(502, { error: 'LORE_QUERY_FAILED', detail: 'Index not found' });
    const e = await fetchLoreSlice('sprints').catch(x => x);
    expect(e).toBeInstanceOf(LoreHttpError);
    expect(e).not.toBeInstanceOf(LoreUpstreamError);
    expect(describeLoreError(e)).toMatchObject({ kind: 'http', status: 502, pageLevel: false });
  });

  it('502 LORE_UPSTREAM — по-прежнему «недоступен» уровня страницы', async () => {
    mockFetch(502, { error: 'LORE_UPSTREAM', detail: 'Connection refused' });
    const e = await fetchLoreSlice('sprints').catch(x => x);
    expect(e).toBeInstanceOf(LoreUpstreamError);
    expect(describeLoreError(e).pageLevel).toBe(true);
  });

  it('сбой сохранения с не-JSON телом тоже не «недоступен»', async () => {
    mockFetch(413, '<html>too large</html>', 'text/html');
    await expect(loreMutate('/task', {})).rejects.toBeInstanceOf(LoreHttpError);
  });
});

describe('describeLoreError: что сказать человеку', () => {
  it('различает пустоту, «не найдено» и ошибку с кодом', () => {
    expect(describeLoreError(new LoreNotFoundError('X')).kind).toBe('notFound');
    expect(describeLoreError(new LoreHttpError(403, 'FORBIDDEN', '')).kind).toBe('forbidden');
    expect(describeLoreError(new LoreHttpError(500, 'X', 'y'))).toMatchObject({ kind: 'http', status: 500 });
    expect(describeLoreError(new LoreConflictError('нельзя')).kind).toBe('conflict');
  });

  it('страницу целиком заменяют только «выключен» и «недоступен»', () => {
    expect(describeLoreError(new LoreDisabledError()).pageLevel).toBe(true);
    expect(describeLoreError(new LoreUpstreamError()).pageLevel).toBe(true);
    expect(describeLoreError(new LoreHttpError(500, 'X', '')).pageLevel).toBe(false);
    expect(describeLoreError(new Error('что-то')).pageLevel).toBe(false);
  });

  it('отменённый запрос (уход с экрана) — не ошибка, показывать нечего', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(describeLoreError(abort).kind).toBe('aborted');
  });

  it('у ошибки всегда есть текст для человека', () => {
    expect(describeLoreError(new LoreHttpError(500, 'X', 'boom')).text).toContain('500');
    expect(describeLoreError('строка').text).toBe('строка');
  });
});

// SPRINT_UXR_S1_HONEST_API/S1-04: срок подключён к транспорту lore.ts, а не только
// лежит в loreTimeout.ts. Повисший fetch → вид 'timeout' на месте, не 'unknown'.
describe('транспорт LORE: срок ответа (S1-04)', () => {
  it('fetchLoreSlice, на который не ответили за LORE_TIMEOUT_MS, — ошибка timeout на месте', async () => {
    vi.useFakeTimers();
    // AbortSignal.timeout живёт на внутренних таймерах Node — подменяем его сигналом
    // на фейковом setTimeout, чтобы срок шёл по advanceTimersByTime.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException('signal timed out', 'TimeoutError')), ms);
      return c.signal;
    });
    vi.stubGlobal('location', { origin: 'http://lore.test' });
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal?.reason), { once: true });
    })));
    const p = fetchLoreSlice('sprints').catch(x => x);
    vi.advanceTimersByTime(LORE_TIMEOUT_MS);
    const e = await p;
    expect(describeLoreError(e)).toMatchObject({ kind: 'timeout', pageLevel: false });
  });

  it('голый DOMException TimeoutError (срок истёк при чтении тела) — тоже timeout', () => {
    expect(describeLoreError(new DOMException('x', 'TimeoutError')).kind).toBe('timeout');
  });
});

// SPRINT_UXR_S1_HONEST_API/S1-07: счётчик секции не выдаёт отказ за ноль.
describe('fetchSectionCount (S1-07)', () => {
  it('отдаёт SectionCount как есть', async () => {
    mockFetch(200, { section: 'sprints', open: 3, closed: 5, byCategory: {}, scope: null, filters: {}, completeness: 'complete' });
    await expect(fetchSectionCount('sprints')).resolves.toMatchObject({ open: 3, closed: 5 });
  });

  it('403 SCOPE_EMPTY и 400 NOT_COUNTABLE — ошибка, а не 0', async () => {
    mockFetch(403, { error: 'SCOPE_EMPTY', detail: 'нет проектов' });
    await expect(fetchSectionCount('sprints')).rejects.toBeInstanceOf(LoreHttpError);
    mockFetch(400, { error: 'NOT_COUNTABLE', detail: 'нет статуса' });
    await expect(fetchSectionCount('components')).rejects.toBeInstanceOf(LoreHttpError);
  });
});
