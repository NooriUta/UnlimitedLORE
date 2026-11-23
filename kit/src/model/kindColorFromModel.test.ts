// K4-MENTION-LOOK (SPRINT_UXR_S13_KIT4): цвет вида приходит из модели —
// `types.<тип>.color` = ИМЯ токена темы, а не hex. Генератор kit переводит его в
// цвет вида (KindConfig.color), которым окрашены упоминания записей этого вида.
// null у типа — честное «канона цвета нет»: вид нейтральный.
//
// Проверяется на модели, СНЯТОЙ с живого сервера (shared/fixtures/model.json,
// CT-KIT-FIXTURES), а не на форме, которую помнит автор: ручная форма этого
// теста 15.11.2026 спрятала дефект — сервер называет цвет `section-adrs`, а тема
// kit держала палитру под именами `--type-*`, и упоминания из модели оставались
// без цвета. Граничные случаи — правкой КОПИИ снятой модели, не рукописной формой.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configFromModel } from './configFromModel';
import { parseModel } from './loadModel';

const MODEL = join(__dirname, '..', '..', 'fixtures', 'model.json') // снимок живой модели LORE (из UnlimitedLORE shared/fixtures, 22.11.2026);
const CSS = join(__dirname, '..', 'styles', 'seidr.css');
type Doc = { types: Record<string, { color?: unknown }> };
const snapshot = (): Doc => JSON.parse(readFileSync(MODEL, 'utf8')) as Doc;
const kindsOf = (doc: Doc) => configFromModel(parseModel(doc), { statusDict: 'none' });
/** Токены, которые тема kit реально объявляет. */
const declared = new Set([...readFileSync(CSS, 'utf8').matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));

describe('configFromModel: цвет вида из модели (живой снимок)', () => {
  it('каждый цвет вида из живой модели — токен, который тема kit объявляет', () => {
    const doc = snapshot();
    const named = Object.entries(doc.types).filter(([, t]) => typeof t?.color === 'string');
    expect(named.length, 'в снимке модели нет ни одного цвета вида — положительного контроля нет').toBeGreaterThan(0);
    const kinds = kindsOf(doc).kinds;
    for (const [name] of named) {
      const color = kinds[name]?.color;
      expect(color, `вид ${name}: цвет из модели потерян`).toMatch(/^var\(--[\w-]+\)$/);
      const token = color!.slice(4, -1);
      expect(declared.has(token), `вид ${name}: ${color} — такого токена в теме kit нет`).toBe(true);
    }
  });

  it('null — цвета нет и замечания про цвет нет: канона у типа нет честно', () => {
    const doc = snapshot();
    const name = Object.keys(doc.types).find(k => doc.types[k]?.color === null);
    expect(name, 'в снимке нет вида без цвета — положительного контроля нет').toBeTruthy();
    const r = kindsOf(doc);
    expect(r.kinds[name!].color).toBeUndefined();
    expect(r.notes.kinds.join(' ')).not.toMatch(new RegExp(`«${name}».*цвет`));
  });

  it('уже var(--…) — как есть', () => {
    const doc = snapshot();
    doc.types.adr = { ...doc.types.adr, color: 'var(--section-adrs)' };
    expect(kindsOf(doc).kinds.adr.color).toBe('var(--section-adrs)');
  });

  it('сырой hex — не токен: цвета нет, причина словами', () => {
    const doc = snapshot();
    doc.types.adr = { ...doc.types.adr, color: '#B48EAD' };
    const r = kindsOf(doc);
    expect(r.kinds.adr.color).toBeUndefined();
    expect(r.notes.kinds.join(' ')).toMatch(/цвет «#B48EAD» не токен/);
  });
});
