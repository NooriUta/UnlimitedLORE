// textOf сжимает пробелы и не трогает буквы (19.11.2026: в develop регулярка оказалась /s+/ вместо /\s+/ —
// шелл съел обратный слэш, и подписи в отчёте смоука теряли букву «s»).
import { describe, expect, it } from 'vitest';
import type { Locator } from '@playwright/test';
import { textOf } from './stand.ts';

const loc = (text: string, n = 1) => ({ count: async () => n, first: () => ({ innerText: async () => text }) }) as unknown as Locator;

describe('textOf', () => {
  it('сжимает пробелы и переносы, буквы s остаются', async () => {
    expect(await textOf(loc('Access  denied\n  status'))).toBe('Access denied status');
  });
  it('нет совпадений — сразу пусто', async () => {
    expect(await textOf(loc('x', 0))).toBe('');
  });
});
