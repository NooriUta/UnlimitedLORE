// SPRINT_UXR_S9_SCALE_OPT/S9-03 — ось «Тег» в фильтрах.
//
// kit-часть задачи сделана 10.11 (разделы фасета, многозначные оси, Σcount >
// total названо нормой), а приложению осталось поставить ось «Тег» туда, где
// у типа есть теги: ADR и решения (`tags` — массив, records.ts). Без оси
// фильтровать по тегам нельзя вовсе, хотя данные есть.
import { describe, expect, it } from 'vitest';
import { LIST_SCREENS } from './screens';

describe('S9-03 · ось «Тег» в фильтрах', () => {
  for (const id of ['adrs', 'decisions'] as const) {
    it(`${id}: фасет по тегам есть, и тип тег объявляет`, () => {
      const cfg = LIST_SCREENS[id].config('ru');
      expect(cfg.list?.filters).toContain(LORE_TAGS);
      const kind = Object.values(cfg.kinds)[0];
      expect(kind.fields?.some(f => f.key === 'tags')).toBe(true);
    });
  }

  it('положительный контроль: у типа без тегов (вехи) оси «Тег» нет — пустой фасет обещал бы фильтр', () => {
    expect(LIST_SCREENS.milestones.config('ru').list?.filters).not.toContain(LORE_TAGS);
  });
});

const LORE_TAGS = 'fields.tags';
