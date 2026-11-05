import { describe, expect, it } from 'vitest';
import { loadFailureOf, loadStateOf, pageLevelError, settleSlices, settledSlices, sliceFailures } from './loadState';
import { LoreHttpError, LoreNotFoundError, LoreUpstreamError } from '../../api/lore';

// SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-07, зона 2. Лента новостей при сбое делала
// setItems([]) и рисовала «Пока ничего не произошло»; useSlice не отдавал error
// вовсе. Правило: у загрузки четыре исхода, и «пусто» — только один из них.
describe('исход загрузки: ошибка ≠ пусто', () => {
  it('ещё грузится', () => {
    expect(loadStateOf(null, null).k).toBe('loading');
  });

  it('пришёл пустой список — это «пусто»', () => {
    expect(loadStateOf([], null).k).toBe('empty');
  });

  it('пришли строки', () => {
    expect(loadStateOf([1, 2], null)).toEqual({ k: 'ok', rows: [1, 2] });
  });

  it('сбой — это ошибка с кодом, даже если строк нет', () => {
    const s = loadStateOf([], new LoreHttpError(403, 'FORBIDDEN', ''));
    expect(s.k).toBe('error');
    if (s.k === 'error') { expect(s.status).toBe(403); expect(s.text).toContain('403'); }
  });

  it('ошибка важнее старых строк: экран не выдаёт прошлые данные за свежие', () => {
    expect(loadStateOf([1], new Error('сеть')).k).toBe('error');
  });
});

// AH-07, зона 4. Экраны с пачкой срезов (аналитика, «Знания», BRAGI, bench)
// валились целиком от одного сбоя или подменяли упавший срез пустым массивом —
// и рисовали нули. Правило: загруженное показывается, упавшее помечено.
describe('пачка срезов: упавший срез — ошибка, а не нули', () => {
  it('разбирает allSettled: значения отдельно, упавшие ключи с текстом отдельно', () => {
    const r = settledSlices<{ a: number[]; b: number[]; c: number[] }>(['a', 'b', 'c'], [
      { status: 'fulfilled', value: [1] },
      { status: 'rejected', reason: new LoreHttpError(500, 'INTERNAL', 'boom') },
      { status: 'fulfilled', value: [] },
    ]);
    expect(r.values).toEqual({ a: [1], c: [] });
    expect(Object.keys(r.failed)).toEqual(['b']);
    expect(r.failed.b).toContain('500');
    expect('b' in r.values).toBe(false);
    expect(r.errors.b).toBeInstanceOf(LoreHttpError);
  });

  it('pageLevelError находит «недоступен» среди упавших, обычный 500 — нет', () => {
    const up = new LoreUpstreamError();
    expect(pageLevelError({ a: new LoreHttpError(500, 'X', '') })).toBeUndefined();
    expect(pageLevelError({ a: new LoreHttpError(500, 'X', ''), b: up })).toBe(up);
  });

  it('отмена запроса сбоем не считается', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const r = settledSlices<{ a: number[] }>(['a'], [{ status: 'rejected', reason: abort }]);
    expect(r.failed).toEqual({});
    expect(r.values).toEqual({});
  });

  it('settleSlices не роняет пачку из-за одного сбоя', async () => {
    const r = await settleSlices({
      ok: Promise.resolve([1, 2]),
      bad: Promise.reject(new Error('сеть')),
    });
    expect(r.values.ok).toEqual([1, 2]);
    expect(r.failed.bad).toBe('сеть');
  });

  it('sliceFailures собирает ошибки хуков-срезов по имени', () => {
    expect(sliceFailures({
      golds: { error: null },
      verdicts: { error: '503 mart' },
      none: null,
    })).toEqual({ verdicts: '503 mart' });
  });
});

// «Спринт X не найден» рисовался и на 404, и на обрыве сети / 500.
describe('сбой ≠ «не найден»', () => {
  it('404 — это «не найден»', () => {
    expect(loadFailureOf(new LoreNotFoundError('S1'))).toEqual({ k: 'notFound' });
  });
  it('5xx — ошибка с кодом', () => {
    const f = loadFailureOf(new LoreHttpError(500, 'INTERNAL', ''));
    expect(f?.k).toBe('error');
    if (f?.k === 'error') { expect(f.status).toBe(500); expect(f.pageLevel).toBe(false); }
  });
  it('сеть — ошибка', () => {
    expect(loadFailureOf(new TypeError('Failed to fetch'))?.k).toBe('error');
  });
  it('недоступность бэкенда — ошибка уровня страницы', () => {
    const f = loadFailureOf(new LoreUpstreamError());
    expect(f?.k === 'error' && f.pageLevel).toBe(true);
  });
  it('отмена — не сбой', () => {
    expect(loadFailureOf(Object.assign(new Error('x'), { name: 'AbortError' }))).toBeNull();
  });
});
