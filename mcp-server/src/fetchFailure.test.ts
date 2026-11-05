import { describe, expect, it, vi } from 'vitest';
import { describeFetchFailure, loreFetch, sliceMetaOf } from './backend.js';

// DS-5 (SPRINT_LORE_MCP_DOCSYNC_GAPS): «fetch failed» без причины.
// Сверка DWL 24.10.2026: doc_new упал с голым «fetch failed», повтор прошёл,
// и почему — сказать было нечем: undici кладёт причину в e.cause, а текст
// ошибки её не содержал.

function netError(code: string, message = 'boom'): TypeError {
  const e = new TypeError('fetch failed');
  (e as { cause?: unknown }).cause = Object.assign(new Error(message), { code });
  return e;
}

describe('сетевой сбой называет причину', () => {
  it('код и сообщение причины попадают в текст ошибки', () => {
    const text = describeFetchFailure('POST /lore/doc', netError('ECONNRESET', 'other side closed'));
    expect(text).toContain('POST /lore/doc');
    expect(text).toContain('ECONNRESET');
    expect(text).toContain('other side closed');
    expect(text).toContain('мог дойти');
  });

  it('ошибка установки соединения помечена как безопасная для повтора', () => {
    expect(describeFetchFailure('GET /x', netError('ECONNREFUSED'))).toContain('запрос не ушёл');
  });

  it('таймаут отличим от сброса', () => {
    const t = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    expect(describeFetchFailure('POST /lore/doc', t)).toContain('таймаут');
  });
});

describe('повтор только там, где запрос не ушёл', () => {
  it('ECONNREFUSED: один повтор, второй ответ отдаётся', async () => {
    const ok = new Response('{}', { status: 200 });
    const f = vi.fn().mockRejectedValueOnce(netError('ECONNREFUSED')).mockResolvedValueOnce(ok);
    const res = await loreFetch('POST /lore/doc', 'http://x/lore/doc', { method: 'POST' }, f as typeof fetch);
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('ECONNRESET: без повтора — запись могла лечь, metric_log задвоился бы', async () => {
    const f = vi.fn().mockRejectedValue(netError('ECONNRESET'));
    await expect(loreFetch('POST /lore/metric', 'http://x', { method: 'POST' }, f as typeof fetch))
      .rejects.toThrow(/ECONNRESET/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('повтор не бесконечен: два отказа соединения — ошибка с причиной', async () => {
    const f = vi.fn().mockRejectedValue(netError('ECONNREFUSED'));
    await expect(loreFetch('GET /x', 'http://x', {}, f as typeof fetch)).rejects.toThrow(/ECONNREFUSED/);
    expect(f).toHaveBeenCalledTimes(2);
  });

  // DS-5 хвост: сброс простаивающего keep-alive сокета (undici: UND_ERR_SOCKET
  // «other side closed», ECONNRESET). Для ЧТЕНИЯ повтор безопасен всегда —
  // GET ничего не пишет; для записи по-прежнему нет (см. тест выше).
  it('GET: обрыв открытого сокета — один повтор, чтение идемпотентно', async () => {
    for (const code of ['UND_ERR_SOCKET', 'ECONNRESET']) {
      const f = vi.fn().mockRejectedValueOnce(netError(code, 'other side closed'))
        .mockResolvedValueOnce(new Response('{"rows":[]}', { status: 200 }));
      const res = await loreFetch('GET /lore/slice/x', 'http://x', {}, f as typeof fetch);
      expect(res.status).toBe(200);
      expect(f).toHaveBeenCalledTimes(2);
    }
  });

  it('POST: обрыв открытого сокета — без повтора, даже UND_ERR_SOCKET', async () => {
    const f = vi.fn().mockRejectedValue(netError('UND_ERR_SOCKET', 'other side closed'));
    await expect(loreFetch('POST /lore/metric', 'http://x', { method: 'POST' }, f as typeof fetch))
      .rejects.toThrow(/UND_ERR_SOCKET/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('каждому запросу задан таймаут', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}'));
    await loreFetch('GET /x', 'http://x', {}, f as typeof fetch);
    expect((f.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe('признак усечения выдачи не теряется', () => {
  it('truncated=true доходит вместе с потолком и подсказкой', () => {
    expect(sliceMetaOf({ rows: [], truncated: true, limit: 2000, hint: 'обрезано' }))
      .toEqual({ truncated: true, limit: 2000, hint: 'обрезано' });
  });

  it('"unknown" — тоже признак, а не «полно»', () => {
    expect(sliceMetaOf({ rows: [], truncated: 'unknown', hint: 'проверить нечем' })?.truncated).toBe('unknown');
  });

  it('обычная выдача меты не несёт', () => {
    expect(sliceMetaOf({ rows: [1, 2] })).toBeUndefined();
  });
});
