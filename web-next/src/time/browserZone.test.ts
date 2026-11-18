// S3 стенда (16.11.2026): лента под test-sa — «HTTP 400 BAD_PARAMS». Chromium без данных о поясе
// (контейнер, урезанная ОС) отдаёт resolvedOptions().timeZone = "Etc/Unknown"; клиент слал его в
// tz, сервер (ZoneId.of) отвечает 400 — и лента не открывается вовсе. Пояс, которого нет, — UTC.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserZone, safeZone } from './browserZone';

describe('safeZone — в запрос уходит только настоящий пояс IANA', () => {
  it('настоящий пояс — как есть', () => {
    expect(safeZone('Europe/Moscow')).toBe('Europe/Moscow');
    expect(safeZone('UTC')).toBe('UTC');
  });
  it('Etc/Unknown, пусто, мусор — UTC', () => {
    expect(safeZone('Etc/Unknown')).toBe('UTC');
    expect(safeZone('')).toBe('UTC');
    expect(safeZone(undefined)).toBe('UTC');
    expect(safeZone('Not/AZone')).toBe('UTC');
  });
});

describe('browserZone — пояс браузера', () => {
  afterEach(() => vi.restoreAllMocks());
  it('браузер не знает пояса (Etc/Unknown) — UTC, а не 400 от сервера', () => {
    const real = Intl.DateTimeFormat;
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((...a: ConstructorParameters<typeof Intl.DateTimeFormat>) => {
      const f = new real(...a);
      if (a.length === 0) return { ...f, resolvedOptions: () => ({ ...f.resolvedOptions(), timeZone: 'Etc/Unknown' }) } as Intl.DateTimeFormat;
      return f;
    }) as unknown as typeof Intl.DateTimeFormat);
    expect(browserZone()).toBe('UTC');
  });
});
