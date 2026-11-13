// PU-11 (SPRINT_UXR_POLISH_UAT_1113/PU-11): подпись кластера-хаба — «27 спек ▸», поэтому у каждого
// типа узла графа LORE есть формы слова «N чего» (one/few/many) в обеих локалях.
import { describe, expect, it } from 'vitest';
import { LORE_GRAPH_TYPES } from './loreGraph';

describe('LORE_GRAPH_TYPES · формы слова для кластера', () => {
  for (const lang of ['ru', 'en'] as const) {
    it(`${lang}: у каждого типа есть one и many с {n}`, () => {
      for (const [k, v] of Object.entries(LORE_GRAPH_TYPES(lang))) {
        expect(v.count, k).toBeTruthy();
        expect(v.count!.one, k).toContain('{n}');
        expect(v.count!.many, k).toContain('{n}');
      }
    });
  }
  it('ru: спеки склоняются', () => {
    const c = LORE_GRAPH_TYPES('ru').spec.count!;
    expect([c.one, c.few, c.many]).toEqual(['{n} спека', '{n} спеки', '{n} спек']);
  });
});
