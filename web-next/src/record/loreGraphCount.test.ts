// PU-11 (SPRINT_UXR_POLISH_UAT_1113/PU-11): подпись кластера-хаба — «27 спек ▸», поэтому у каждого
// типа узла графа LORE есть формы слова «N чего» (one/few/many) в обеих локалях.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// PU-11, приёмка preprod 14.11 (v1.17.21): OMILORE → Граф (Force) — 48 соседей по DOCUMENTED_IN
// подписаны «DOCUMENTED_IN: 48». Соседи — 25 спек (вид spec) и 23 технологии (вид tech: KnowSpec
// с ключом SPEC-TECH-…, LoreGraphResource.toNode). У tech форм слова не было: формы подбирались
// руками по 14 видам. Правило: формы есть у КАЖДОГО вида записи модели сервера
// (shared/model/lore-model.json: types[].type и graph{}), а не у выбранных руками.
describe('PU-11 · формы слова у каждого вида записи сервера', () => {
  const model = JSON.parse(readFileSync(resolve(__dirname, '..', '..', '..', 'shared', 'model', 'lore-model.json'), 'utf8')) as
    { types: { type: string }[]; graph: Record<string, unknown> };
  const kinds = [...new Set([...model.types.map(t => t.type), ...Object.keys(model.graph)])].sort();

  it('реестр видов прочитан (положительный контроль)', () => {
    expect(kinds).toContain('spec');
    expect(kinds).toContain('tech');
  });

  for (const lang of ['ru', 'en'] as const) {
    it(`${lang}: у каждого вида модели есть подпись и формы «N чего»`, () => {
      const types = LORE_GRAPH_TYPES(lang);
      const missing = kinds.filter(k => {
        const v = types[k];
        return !v || !v.label || v.label === k || !v.count?.one.includes('{n}') || !v.count?.many.includes('{n}');
      });
      expect(missing).toEqual([]);
    });
  }

  it('ru: технологии склоняются', () => {
    const c = LORE_GRAPH_TYPES('ru').tech?.count;
    expect(c && [c.one, c.few, c.many]).toEqual(['{n} технология', '{n} технологии', '{n} технологий']);
  });
});
