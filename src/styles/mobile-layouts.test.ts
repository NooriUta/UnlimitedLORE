import { describe, it, expect } from 'vitest';

/**
 * SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-08 · экраны из мобильного аудита подключены
 * к общей раскладке.
 *
 * Чистые функции mobileLayout.ts проверены своим тестом, но сами по себе ничего
 * не чинят: экран, который их не вызывает, остаётся с фиксированной колонкой.
 * Тест читает ИСХОДНИКИ и требует, чтобы каждый экран из аудита брал раскладку
 * оттуда, а ручки ресайза плана и паспорта слушали pointer, а не мышь.
 */
const sources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = (tail: string) => {
  const hit = Object.entries(sources).find(([p]) => p.endsWith(tail));
  if (!hit) throw new Error(`исходник не найден: ${tail}`);
  return hit[1];
};

const SCREENS: [string, RegExp][] = [
  ['/components/tyr/TyrApp.tsx',                       /tyrReportsLayout\(/],
  ['/components/lore/LoreTimeline.tsx',                /timelineRow\(/],
  ['/components/lore/LoreEvolutionView.tsx',           /evolutionPanes\(/],
  ['/components/lore/LoreBragiPlan.tsx',               /bragiPlanLayout\(/],
  ['/components/lore/LoreComponentPassport.tsx',       /passportLayout\(/],
  ['/components/bench/BiblioScreen.tsx',               /biblioPanes\(/],
  ['/components/lore/LoreAnalytics.tsx',               /scrollStrip/],
  ['/components/lore/LoreMilestonesView.tsx',          /milestonesTwoCol\(/],
  ['/components/lore/LoreBragiPublicationEditor.tsx',  /wrapHeader\(/],
];

describe('AH-08 · экраны аудита берут раскладку из mobileLayout', () => {
  for (const [file, re] of SCREENS) {
    it(file, () => { expect(src(file)).toMatch(re); });
  }

  it('оболочка: проект в «⋯» и «где я» текстом на телефоне', () => {
    const s = src('/components/layout/AppShell.tsx');
    expect(s).toMatch(/projectPickerInMore\(/);
    expect(s).toMatch(/whereAmILabel\(/);
  });
});

describe('AH-08 · ручки ресайза плана и паспорта — pointer events', () => {
  for (const file of ['/components/lore/LorePlanBoard.tsx', '/components/lore/LoreComponentPassport.tsx']) {
    it(file, () => {
      const s = src(file);
      expect(s).toMatch(/onPointerDown=/);
      expect(s).toMatch(/startPointerDrag\(/);
      // Мышиный ресайз не должен остаться параллельной веткой.
      expect(s).not.toMatch(/addEventListener\('mousemove'/);
    });
  }
});
