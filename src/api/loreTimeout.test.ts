import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LORE_TIMEOUT_MS, LoreTimeoutError, describeLoreTimeout, isLoreTimeout, loreFetch, loreSignal,
} from './loreTimeout';

// SPRINT_UXR_S1_HONEST_API/S1-04 (B-03): запрос к LORE без срока жил вечно —
// повисший бэкенд/прокси давал бесконечный спиннер, неотличимый от «ещё грузится».
// Правило: у каждого запроса есть срок; не дождались — это отдельный честный
// исход «не дождались ответа», а не «пусто», не «отменено» и не вечная загрузка.

/** fetch, который отвечает только по abort своего signal — «повисший сервер». */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    const s = init?.signal;
    if (!s) return; // без signal — висит навсегда (так было до S1-04)
    if (s.aborted) { rej(s.reason); return; }
    s.addEventListener('abort', () => rej(s.reason), { once: true });
  }));
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('loreFetch: у запроса есть срок', () => {
  it('срок по умолчанию задан и разумен (не 0 и не бесконечность)', () => {
    expect(LORE_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(LORE_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });

  it('повисший сервер → LoreTimeoutError, а не вечное ожидание', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const e = await loreFetch('/lore/slice/sprints', {}, 30).catch(x => x);
    expect(e).toBeInstanceOf(LoreTimeoutError);
    expect((e as LoreTimeoutError).ms).toBe(30);
    expect(isLoreTimeout(e)).toBe(true);
  });

  it('fetch всегда получает signal, даже если вызывающий его не дал', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', f);
    await loreFetch('/lore/x');
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('отмена вызывающим (уход с экрана) остаётся AbortError, а не «не дождались»', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const ctrl = new AbortController();
    const p = loreFetch('/lore/x', { signal: ctrl.signal }, 10_000).catch(x => x);
    ctrl.abort();
    const e = await p;
    expect((e as Error).name).toBe('AbortError');
    expect(isLoreTimeout(e)).toBe(false);
  });

  it('уже отменённый signal не превращается в таймаут', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const ctrl = new AbortController();
    ctrl.abort();
    const e = await loreFetch('/lore/x', { signal: ctrl.signal }, 10).catch(x => x);
    expect((e as Error).name).toBe('AbortError');
  });

  it('быстрый ответ проходит как есть, остальные поля init сохранены', async () => {
    const res = { ok: true, status: 200 } as Response;
    const f = vi.fn().mockResolvedValue(res);
    vi.stubGlobal('fetch', f);
    expect(await loreFetch('/lore/x', { method: 'POST', body: '{}' }, 1_000)).toBe(res);
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' });
  });

  it('прочие сетевые ошибки не маскируются под таймаут', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const e = await loreFetch('/lore/x', {}, 1_000).catch(x => x);
    expect(e).toBeInstanceOf(TypeError);
    expect(isLoreTimeout(e)).toBe(false);
  });
});

describe('loreSignal: срок + отмена вызывающего в одном сигнале', () => {
  it('срабатывает по сроку с причиной TimeoutError', async () => {
    const s = loreSignal(undefined, 10);
    await new Promise(r => setTimeout(r, 40));
    expect(s.aborted).toBe(true);
    expect(isLoreTimeout(s.reason)).toBe(true);
  });

  it('срабатывает по отмене вызывающего с его причиной', () => {
    const ctrl = new AbortController();
    const s = loreSignal(ctrl.signal, 10_000);
    ctrl.abort();
    expect(s.aborted).toBe(true);
    expect((s.reason as Error).name).toBe('AbortError');
  });
});

describe('isLoreTimeout / describeLoreTimeout: что сказать человеку', () => {
  it('узнаёт и свой класс, и голый DOMException TimeoutError (таймаут при чтении тела)', () => {
    expect(isLoreTimeout(new LoreTimeoutError(30_000))).toBe(true);
    expect(isLoreTimeout(new DOMException('signal timed out', 'TimeoutError'))).toBe(true);
    expect(isLoreTimeout(new DOMException('aborted', 'AbortError'))).toBe(false);
    expect(isLoreTimeout(new Error('x'))).toBe(false);
    expect(isLoreTimeout('TimeoutError')).toBe(false);
  });

  it('таймаут — отдельный вид «timeout», на месте, а не на всю страницу', () => {
    const d = describeLoreTimeout(new LoreTimeoutError(30_000));
    expect(d).toMatchObject({ kind: 'timeout', pageLevel: false });
    expect(d!.text).toContain('не дождались');
    expect(d!.text).toContain('30');
  });

  it('голый TimeoutError тоже описывается честно', () => {
    const d = describeLoreTimeout(new DOMException('signal timed out', 'TimeoutError'));
    expect(d).toMatchObject({ kind: 'timeout', pageLevel: false });
    expect(d!.text).toContain('не дождались');
  });

  it('не-таймаут → null (решает основной describeLoreError)', () => {
    expect(describeLoreTimeout(new Error('x'))).toBeNull();
    expect(describeLoreTimeout(new DOMException('aborted', 'AbortError'))).toBeNull();
  });
});
