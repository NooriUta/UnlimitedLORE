// SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE — свободные поля на ребре TAGGED_WITH при переносе в модель 1.18:
// схема приёмника объявляет свойство-словарь и отметки по разделу edge_free_fields модели, существующие
// TAGGED_WITH переносятся без потерь (и голые, и с полями), сверка ловит потерянное значение.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FREE_FIELD_EDGES, carriesFreeFields, edgeFreeFieldsDdl, stampFreeFields, freeFieldsLoss } from './edge-free-fields.mjs';
import { edgeWrites } from './edge-plan.mjs';

const AT = '2026-11-19T10:00:00.000Z';

test('связи со свободными полями — из модели', () => {
  assert.deepEqual(FREE_FIELD_EDGES, ['TAGGED_WITH']);
  assert.ok(carriesFreeFields('TAGGED_WITH'));
  assert.ok(!carriesFreeFields('PART_OF'));
});

test('схема 1.18 строится из модели: словарь полей и отметки у TAGGED_WITH, у прочих — ничего', () => {
  assert.deepEqual(edgeFreeFieldsDdl('TAGGED_WITH'), [
    'CREATE PROPERTY TAGGED_WITH.fields IF NOT EXISTS MAP',
    'CREATE PROPERTY TAGGED_WITH.tagged_at IF NOT EXISTS DATETIME',
    'CREATE PROPERTY TAGGED_WITH.tagged_by IF NOT EXISTS STRING',
    'CREATE PROPERTY TAGGED_WITH.changed_at IF NOT EXISTS DATETIME',
    'CREATE PROPERTY TAGGED_WITH.changed_by IF NOT EXISTS STRING',
  ]);
  assert.deepEqual(edgeFreeFieldsDdl('PART_OF'), []);
});

test('перенос существующих TAGGED_WITH без потерь: голые рёбра и рёбра с полями', () => {
  const src = { TAGGED_WITH: [
    { r: '#90:0', o: '#1:0', i: '#5:0', props: {} },                                         // ADR → тег, голое (как сейчас на проде)
    { r: '#90:1', o: '#2:0', i: '#6:0', props: {} },                                         // задача → компонент
    { r: '#90:2', o: '#1:1', i: '#5:0', props: { fields: { risk: 'high', due: '2026-11-27' }, tagged_at: '2026-11-20 10:00:00', tagged_by: 'arharaga' } },
  ] };
  const dstRid = new Map([['#1:0', '#11:0'], ['#1:1', '#11:1'], ['#2:0', '#12:0'], ['#5:0', '#15:0'], ['#6:0', '#16:0']]);
  const { writes, missingEnds } = edgeWrites(src, dstRid, { TAGGED_WITH: { rule: 'keep' } });
  assert.deepEqual(missingEnds, {});
  const list = writes.TAGGED_WITH;
  assert.equal(list.length, 3, 'все три ребра — и к тегу, и к компоненту');
  assert.deepEqual(list[2].content.fields, { risk: 'high', due: '2026-11-27' }, 'словарь полей переносится как есть');
  const stats = stampFreeFields('TAGGED_WITH', list);
  assert.equal(list[2].content.tagged_at, '2026-11-20T10:00:00.000Z', 'момент — в DATETIME приёмника');
  assert.equal(list[2].content.tagged_by, 'arharaga');
  assert.ok(!('fields' in list[0].content), 'голому ребру словарь не выдумывается');
  assert.deepEqual(stats, { with_fields: 1, bare: 2, values: 2 });
  assert.equal(stampFreeFields('PART_OF', []), null);
});

test('сверка: потерянное или изменённое значение поля — потеря, совпадение — ноль', () => {
  const expected = [
    { content: { mig_src_rid: '#90:0' } },
    { content: { mig_src_rid: '#90:2', fields: { risk: 'high', due: '2026-11-27' } } },
  ];
  assert.deepEqual(freeFieldsLoss(expected, [{ s: '#90:0', fields: null }, { s: '#90:2', fields: { due: '2026-11-27', risk: 'high' } }]),
    { checked: 2, lost: [] }, 'порядок ключей не важен');
  const lost = freeFieldsLoss(expected, [{ s: '#90:2', fields: { risk: 'medium' } }]);
  assert.deepEqual(lost.lost.map(x => x.src).sort(), ['#90:0', '#90:2'], 'пропало ребро и изменилось значение');
});

test('шаг связей вызывает схему и сверку свободных полей (сторож по исходнику)', () => {
  const s = fs.readFileSync(new URL('./transfer-edges.mjs', import.meta.url), 'utf8');
  assert.match(s, /edgeFreeFieldsDdl\(T\)/);
  assert.match(s, /stampFreeFields\(T, list\)/);
  assert.match(s, /freeFieldsLoss\(/);
});
