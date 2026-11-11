// @vitest-environment jsdom
// Телефон в ландшафте — тоже телефон (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-EDGE, ADR-LORE-049 п.7).
//
// Замер 11.11.2026 (v2, 800×360, пальцевый ввод): ширина больше 720, поэтому
// включалась десктопная раскладка. Первая строка списка стояла на 507 px при
// высоте экрана 360 — содержимого не видно вовсе; паспорт шириной 1017 px
// вылезал за экран в 800.
//
// Правило: «узко» = ширина ≤720 ИЛИ пальцевый ввод при высоте ≤500. Одно на
// весь kit и на CSS приложения: хук, его дубль в ReadingView и каждый @media
// с узким порогом обязаны говорить одно и то же, иначе в ландшафте часть
// экрана станет телефонной, а часть останется десктопной.
import { describe, expect, it, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { NARROW_QUERY, useNarrow } from './narrow';

const LANDSCAPE = '(pointer: coarse) and (max-height: 500px)';
const root = `${process.cwd()}/..`;
const read = (p: string) => readFileSync(`${root}/${p}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Все условия @media, где есть узкий порог 720. */
const narrowMedia = (css: string) => [...css.matchAll(/@media([^{]*max-width:\s*720px[^{]*)\{/g)].map(m => m[1].trim());

describe('ландшафт телефона — тоже «узко»', () => {
  it('порог хука: ширина ≤720 или палец при высоте ≤500', () => {
    expect(NARROW_QUERY).toContain('(max-width: 720px)');
    expect(NARROW_QUERY).toContain(LANDSCAPE);
  });

  describe('useNarrow отвечает «узко», когда совпала ландшафтная часть', () => {
    const orig = window.matchMedia;
    afterEach(() => { window.matchMedia = orig; });

    it('палец при малой высоте — узко', () => {
      window.matchMedia = ((q: string) => ({
        matches: q === NARROW_QUERY, media: q, addEventListener: () => {}, removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
      expect(renderHook(() => useNarrow()).result.current).toBe(true);
    });
  });

  it('ReadingView не держит свой порог, а берёт общий', () => {
    const src = read('kit/src/reading/ReadingView.tsx');
    expect(src).not.toMatch(/const NARROW_QUERY\s*=/);
    expect(src).toMatch(/NARROW_QUERY/);
  });

  for (const file of ['kit/src/styles/seidr.css', 'web-next/src/pages/KitPage.css', 'web-next/src/pages/ListScreen.css']) {
    it(`${file}: каждый узкий @media включает ландшафт телефона`, () => {
      const media = narrowMedia(read(file));
      expect(media.length, 'положительный контроль: узкие @media найдены').toBeGreaterThan(0);
      const without = media.filter(m => !m.includes(LANDSCAPE));
      expect(without).toEqual([]);
    });
  }
});
