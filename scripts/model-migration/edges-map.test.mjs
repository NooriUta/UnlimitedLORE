// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 — карта связей: у каждой переносимой связи названы смысл, вид, место
// показа по обеим сторонам и способы анализа (методика паспорта §7.8). Слова — только из словаря карты:
// опечатка в виде или месте иначе молча дала бы «связь без места».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const map = JSON.parse(fs.readFileSync(new URL('./map/sprint-phase-task.edges.json', import.meta.url), 'utf8'));
const V = map._vocab;
const edges = Object.entries(map.edges);

test('положительный контроль: карта прочитана, словарь есть', () => {
  assert.ok(edges.length >= 20, 'связей в карте: ' + edges.length);
  assert.ok(V && V.meaning.length && Object.keys(V.kind).length && Object.keys(V.place).length && V.analysis.length);
});

test('у каждой связи, кроме снятых, есть описание из слов словаря', () => {
  const bad = [];
  for (const [name, e] of edges) {
    if (e.rule === 'drop') { if (e.shape) bad.push(name + ': снятая связь с описанием'); continue; }
    const s = e.shape;
    if (!s) { bad.push(name + ': нет описания'); continue; }
    if (!V.meaning.includes(s.meaning)) bad.push(`${name}: смысл «${s.meaning}»`);
    if (!(s.kind in V.kind)) bad.push(`${name}: вид «${s.kind}»`);
    for (const side of ['out', 'in']) if (!(s.place?.[side] in V.place)) bad.push(`${name}: место ${side} «${s.place?.[side]}»`);
    if (!s.analysis?.length) bad.push(name + ': не сказано, как анализируют');
    for (const a of s.analysis || []) if (!V.analysis.includes(a)) bad.push(`${name}: анализ «${a}»`);
    for (const [end, o] of Object.entries(s.ends || {})) {
      if (!/^\w+>\w+$/.test(end)) bad.push(`${name}: концы «${end}»`);
      if (!(o.kind in V.kind)) bad.push(`${name} ${end}: вид «${o.kind}»`);
    }
    if (!['owner', 'proposal', 'open'].includes(s.shape_basis)) bad.push(`${name}: основание «${s.shape_basis}»`);
  }
  assert.deepEqual(bad, []);
});

test('состав показывается таблицей-частью хотя бы с одной стороны', () => {
  for (const [name, e] of edges) {
    const s = e.shape;
    if (!s || !['composition', 'aggregation'].includes(s.kind)) continue;
    assert.ok(s.place.out === 'part' || s.place.in === 'part', name + ': состав без таблицы-части');
  }
});
