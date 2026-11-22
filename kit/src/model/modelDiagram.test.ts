// Схема модели (ER) из документа model/0 — SPRINT_UXR_S15_KIT6; LORE 22.11.2026: «по умолчанию — один вид с соседями
// на шаг, разрез по пространству меню, полная карта — по отдельному нажатию; переходы статусов — да; приватность —
// не догадкой». Кубик не знает ни одного предметного имени: всё из документа.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { modelGraph, modelSlices, modelErText, sliceKinds } from './modelDiagram';

const DOC = {
  format: 'model/0', version: 't', partial: false, missing: [], statuses_known: ['a', 'b'],
  statuses: { a: { entries: [{ code: 'x', title: 'Икс', category: 'not_started', allow: ['y'] }, { code: 'y', title: 'Игрек', category: 'in_force' }] } },
  types: {
    a: { type: 'a', label: 'Альфа', fields: [{ key: 'name', label: 'Имя "главное"', kind: 'text', group: 'head', display: { priority: 1 } }],
      relations: [{ key: 'b', label: 'Бета', rel: 'IN', dir: 'out', relation: 'composition', target_type: 'b' }] },
    b: { type: 'b', label: 'Бета', fields: [{ key: 'n', label: 'Номер', kind: 'number', group: 'props' }],
      relations: [{ key: 'as', label: 'Альфы', rel: 'IN', dir: 'in', relation: 'composition' }, { key: 'c', label: 'Це', rel: 'TO', dir: 'out', relation: 'association' }] },
    c: { type: 'c', label: 'Це', fields: [], relations: [{ key: 'bs', label: 'Беты', rel: 'TO', dir: 'in', relation: 'association' }] },
    d: { type: 'd', label: 'Дэ', fields: [], relations: [] },
  },
  surfaces: { nav: [{ id: 'g1', label: 'Группа 1', items: [{ section: 'a' }, { section: 'b' }] }, { id: 'g2', label_key: 'k.g2', items: [{ section: 'd' }] }] },
};

describe('граф модели', () => {
  it('виды с полями и статусами; связь — по target_type, а без него — по паре out/in той же связи', () => {
    const g = modelGraph(DOC);
    expect(g.kinds.map((k) => k.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(g.kinds[0].statuses.map((s) => [s.code, s.allow])).toEqual([['x', ['y']], ['y', null]]);
    expect(g.rels).toEqual([
      { from: 'a', to: 'b', rel: 'IN', label: 'Бета', relation: 'composition' },
      { from: 'b', to: 'c', rel: 'TO', label: 'Це', relation: 'association' },
    ]);
  });
  it('разрез «вид с соседями на шаг» и разрез по группе меню', () => {
    const g = modelGraph(DOC);
    expect(sliceKinds(g, { focus: 'b' })).toEqual(['a', 'b', 'c']);
    expect(sliceKinds(g, { focus: 'd' })).toEqual(['d']);
    expect(modelSlices(DOC, (k) => (k === 'k.g2' ? 'Группа 2' : undefined))).toEqual([
      { id: 'g1', label: 'Группа 1', kinds: ['a', 'b'] }, { id: 'g2', label: 'Группа 2', kinds: ['d'] }]);
  });
});

describe('связь без известного конца', () => {
  it('не теряется молча: попадает в dangling с видом, связью и подписью (LORE 22.11: «видимая дырка лучше»)', () => {
    const doc = { ...DOC, types: { ...DOC.types, d: { type: 'd', label: 'Дэ', fields: [], relations: [{ key: 'x', label: 'Икс', rel: 'OLD', dir: 'out', relation: 'association' }] } } };
    const g = modelGraph(doc);
    expect(g.dangling).toEqual([{ from: 'd', rel: 'OLD', label: 'Икс' }]);
    expect(g.rels.some((r) => r.rel === 'OLD')).toBe(false);
  });
});

describe('текст ER', () => {
  it('erDiagram: сущности разреза, поля с типом, кавычки в подписях не ломают разбор, связи только внутри разреза', () => {
    const g = modelGraph(DOC);
    const t = modelErText(g, ['a', 'b']);
    expect(t.startsWith('erDiagram')).toBe(true);
    expect(t).toContain('A }o--|| B : "IN · Бета"');
    expect(t).not.toContain(' C ');
    expect(t).toContain(`string name "Имя 'главное' · head"`);
    expect(t).toContain('number n "Номер · props"');
  });
});

describe('на живых моделях', () => {
  it('снимок модели LORE разбирается: каждая связь ведёт к существующему виду', () => {
    const lore = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'model.json'), 'utf8'));
    const g = modelGraph(lore);
    expect(g.kinds.length).toBeGreaterThan(10);
    const ids = new Set(g.kinds.map((k) => k.id));
    for (const r of g.rels) { expect(ids.has(r.from)).toBe(true); expect(ids.has(r.to)).toBe(true); }
    expect(modelSlices(lore).length).toBeGreaterThan(1);
  });
});
