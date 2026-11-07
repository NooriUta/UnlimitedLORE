import { describe, it, expect } from 'vitest';
import { sourceOf } from '../test/sourceOf';

/**
 * SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-08 · экраны из мобильного аудита подключены
 * к общей раскладке.
 *
 * Чистые функции mobileLayout.ts проверены своим тестом, но сами по себе ничего
 * не чинят: экран, который их не вызывает, остаётся с фиксированной колонкой.
 * Тест читает ИСХОДНИКИ и требует, чтобы каждый экран из аудита брал раскладку
 * оттуда, а ручки ресайза плана и паспорта слушали pointer, а не мышь.
 */
// SPRINT_UXR_S0_SAFETY/S0-07: экран ищется по объявленному компоненту, а не по
// пути файла — переезд экрана в другую папку тест не роняет (src/test/sourceOf.ts).
const src = sourceOf;

const SCREENS: [string, RegExp][] = [
  ['TyrApp',                      /tyrReportsLayout\(/],
  ['LoreTimeline',                /timelineRow\(/],
  ['LoreEvolutionView',           /evolutionPanes\(/],
  ['LoreBragiPlan',               /bragiPlanLayout\(/],
  ['LoreComponentPassport',       /passportLayout\(/],
  ['BiblioScreen',                /biblioPanes\(/],
  ['LoreAnalyticsView',           /scrollStrip/],
  ['LoreMilestonesView',          /milestonesTwoCol\(/],
  ['LoreBragiPublicationEditor',  /wrapHeader\(/],
];

describe('AH-08 · экраны аудита берут раскладку из mobileLayout', () => {
  for (const [name, re] of SCREENS) {
    it(name, () => { expect(src(name)).toMatch(re); });
  }

  it('оболочка: проект в «⋯» и «где я» текстом на телефоне', () => {
    const s = src('AppShell');
    expect(s).toMatch(/projectPickerInMore\(/);
    expect(s).toMatch(/whereAmILabel\(/);
  });
});

describe('AH-08 · ручки ресайза плана и паспорта — pointer events', () => {
  for (const name of ['LorePlanBoard', 'LoreComponentPassport']) {
    it(name, () => {
      const s = src(name);
      expect(s).toMatch(/onPointerDown=/);
      expect(s).toMatch(/startPointerDrag\(/);
      // Мышиный ресайз не должен остаться параллельной веткой.
      expect(s).not.toMatch(/addEventListener\('mousemove'/);
    });
  }
});
