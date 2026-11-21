// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Общая карта связей для всех объектов (пункт 1 передачи HANDOFF.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { edgePlan, convertKey } from './edge-plan.mjs';

const ALL = JSON.parse(fs.readFileSync(new URL('./map/all.edges.json', import.meta.url), 'utf8'));
const TRIPLES = fs.readFileSync(new URL('./tools/census/edge-triples.tsv', import.meta.url), 'utf8').trim().split(/\r?\n/)
  .map(l => l.split('\t')).map(([edge, from, to, n]) => ({ edge, from, to, n: +n }));
const OBJ = JSON.parse(fs.readFileSync(new URL('./map/all-objects.json', import.meta.url), 'utf8'));
const TYPES = new Set([...Object.keys(OBJ.types), 'KnowSprint', 'KnowSprintHist', 'KnowPhase', 'KnowPhaseHist', 'KnowTask', 'KnowTaskHist']);

test('у каждой связи прода есть правило — связь вне карты была бы ошибкой переноса', () => {
  const missing = [...new Set(TRIPLES.map(t => t.edge))].filter(e => !ALL.edges[e]);
  assert.deepEqual(missing, []);
});

test('связи снятой план-доски не переносятся', () => {
  const p = edgePlan(TRIPLES, ALL.edges, TYPES);
  assert.equal(p.ON_MILESTONE.rule, 'drop');
  assert.match(p.ON_MILESTONE.why, /PlanCheckpoint/);
});

// MD-05 · release.Q37 (решение 16.11.2026, «ничего не теряется»): HAS_PR своим типом не переносится, а уникальные пары
// переводятся в живые рёбра по типу начала: задача → PR в CLOSED_BY, релиз → PR в SHIPPED_IN (PR → релиз, разворот).
// Спринт → PR — вопрос sprint.Q6: вида связи спринт → PR в модели нет, эти 122 пары не переносятся (причина в плане).
test('HAS_PR переводится по типу начала: задача → CLOSED_BY, релиз → SHIPPED_IN разворотом; спринт — не переносится с причиной', () => {
  const p = edgePlan(TRIPLES, ALL.edges, TYPES);
  assert.equal(p.HAS_PR.rule, 'convert');
  assert.deepEqual(p.HAS_PR.by_from, { KnowTask: { to: 'CLOSED_BY' }, KnowRelease: { to: 'SHIPPED_IN', reverse: true } });
  assert.deepEqual(p.HAS_PR.ends.map(e => e.from).sort(), ['KnowRelease', 'KnowTask']);
  const sprint = p.HAS_PR.dropped_ends.find(e => e.from === 'KnowSprint');
  assert.ok(sprint, 'спринт → PR — в отчёте как непереносимый конец');
  assert.equal(sprint.n, 122);
  assert.match(sprint.why, /sprint\.Q6/);
});

test('перевод по типу начала: свойства роли не переносятся, пара, уже живая в цели, не дублируется, чужой тип начала — в отчёт', async () => {
  const { edgeWrites } = await import('./edge-plan.mjs');
  const dstRid = new Map([['#t:1', '#D:1'], ['#t:2', '#D:2'], ['#p:1', '#D:5'], ['#p:2', '#D:6'], ['#r:1', '#D:9'], ['#s:1', '#D:7']]);
  const plan = {
    CLOSED_BY: { rule: 'keep' }, SHIPPED_IN: { rule: 'keep' },
    HAS_PR: { rule: 'convert', by_from: { KnowTask: { to: 'CLOSED_BY' }, KnowRelease: { to: 'SHIPPED_IN', reverse: true } } },
  };
  const src = {
    CLOSED_BY: [{ r: '#e:1', o: '#t:1', i: '#p:1', props: {} }],
    SHIPPED_IN: [{ r: '#e:2', o: '#p:1', i: '#r:1', props: {} }],
    HAS_PR: [
      { r: '#h:1', o: '#t:1', i: '#p:1', ot: 'KnowTask', props: {} },     // уже есть живым CLOSED_BY — дубль
      { r: '#h:2', o: '#t:2', i: '#p:2', ot: 'KnowTask', props: {} },     // уникальная — в CLOSED_BY
      { r: '#h:3', o: '#r:1', i: '#p:2', ot: 'KnowRelease', props: {} },  // уникальная — SHIPPED_IN PR → релиз
      { r: '#h:4', o: '#r:1', i: '#p:1', ot: 'KnowRelease', props: {} },  // уже есть живым SHIPPED_IN — дубль
      { r: '#h:5', o: '#s:1', i: '#p:1', ot: 'KnowSprint', props: {} },   // спринт → PR — не переносится
    ],
  };
  const w = edgeWrites(src, dstRid, plan);
  assert.deepEqual(w.writes.CLOSED_BY.map(x => x.from + '>' + x.to), ['#D:1>#D:5', '#D:2>#D:6']);
  assert.deepEqual(w.writes.SHIPPED_IN.map(x => x.from + '>' + x.to), ['#D:5>#D:9', '#D:6>#D:9']);
  assert.deepEqual(w.writes.CLOSED_BY[1].content, { mig_src_rid: '#h:2' });
  assert.equal(w.duplicates.HAS_PR, 2);
  assert.deepEqual(w.converted.HAS_PR, { CLOSED_BY: 1, SHIPPED_IN: 1 });
  assert.deepEqual(w.skippedFrom.HAS_PR, { KnowSprint: 1 });
  assert.equal(w.writes.HAS_PR, undefined, 'своим типом HAS_PR не пишется');
});

test('чтение связей источника: у перевода по типу начала выбирается и тип начала, у прочих — запись связи целиком', async () => {
  const { srcEdgeSql, srcEdgeRow } = await import('./edge-plan.mjs');
  const byFrom = srcEdgeSql('HAS_PR', { rule: 'convert', by_from: { KnowTask: { to: 'CLOSED_BY' } } }, '#-1:-1');
  assert.equal(byFrom, 'SELECT @rid AS r, @out AS o, @in AS i, @out.@type AS ot FROM HAS_PR WHERE @rid > #-1:-1 ORDER BY @rid LIMIT 5000');
  assert.equal(srcEdgeSql('PART_OF', { rule: 'keep' }, '#1:2'), 'SELECT FROM PART_OF WHERE @rid > #1:2 ORDER BY @rid LIMIT 5000');
  assert.deepEqual(srcEdgeRow({ r: '#e:1', o: '#t:1', i: '#p:1', ot: 'KnowTask' }),
    { r: '#e:1', o: '#t:1', i: '#p:1', ot: 'KnowTask', props: {} }, 'у перевода по типу начала свойства (role) не читаются — решение «HAS_PR.role: снять»');
  assert.deepEqual(srcEdgeRow({ '@rid': '#e:2', '@out': '#s:1', '@in': '#s:2', out: '#s:1', in: '#s:2', since: '2026' }),
    { r: '#e:2', o: '#s:1', i: '#s:2', props: { since: '2026' } });
});

test('convert без цели и без перевода по типу начала — ошибка, а не тихий пропуск', () => {
  assert.throws(() => edgePlan([{ edge: 'X', from: 'KnowTask', to: 'KnowPR', n: 1 }], { X: { rule: 'convert' } }, new Set(['KnowTask', 'KnowPR'])), /без цели/);
});

test('мёртвые RELEASED_IN и INCLUDES переводятся в IMPLEMENTED_IN_RELEASE (спринт → релиз), INCLUDES — разворотом', () => {
  const p = edgePlan(TRIPLES, ALL.edges, TYPES);
  assert.deepEqual([p.RELEASED_IN.rule, p.RELEASED_IN.to, !!p.RELEASED_IN.reverse], ['convert', 'IMPLEMENTED_IN_RELEASE', false]);
  assert.deepEqual([p.INCLUDES.rule, p.INCLUDES.to, p.INCLUDES.reverse], ['convert', 'IMPLEMENTED_IN_RELEASE', true]);
});

test('прежние «ждут своего объекта» при полном переносе — переносятся', () => {
  const p = edgePlan(TRIPLES, ALL.edges, TYPES);
  for (const e of ['ROLE_HELD_BY', 'TAGGED_WITH', 'BELONGS_TO', 'CLOSED_BY', 'SHIPPED_IN', 'USES']) assert.equal(p[e].rule, 'keep', e);
});

test('связь к непереносимому типу не переносится, даже если правило keep — и это видно в причине', () => {
  const p = edgePlan([{ edge: 'X', from: 'KnowADR', to: 'PlanTrack', n: 1 }], { X: { rule: 'keep' } }, TYPES);
  assert.equal(p.X.rule, 'drop');
  assert.match(p.X.why, /PlanTrack/);
});

test('правила нет — ошибка, а не тихий пропуск', () => {
  assert.throws(() => edgePlan([{ edge: 'NEW_EDGE', from: 'KnowADR', to: 'KnowADR', n: 1 }], {}, TYPES), /NEW_EDGE/);
});

test('ключ дубля при переводе: пара концов в направлении цели', () => {
  assert.equal(convertKey({ o: '#1:1', i: '#2:2' }, false), '#1:1>#2:2');
  assert.equal(convertKey({ o: '#2:2', i: '#1:1' }, true), '#1:1>#2:2');
});

test('что записать: keep — те же концы и свойства; convert — под целью, с разворотом, без дублей', async () => {
  const { edgeWrites } = await import('./edge-plan.mjs');
  const dstRid = new Map([['#s:1', '#d:1'], ['#s:2', '#d:2'], ['#r:1', '#d:9']]);
  const plan = { PART_OF: { rule: 'keep' }, IMPLEMENTED_IN_RELEASE: { rule: 'keep' }, INCLUDES: { rule: 'convert', to: 'IMPLEMENTED_IN_RELEASE', reverse: true }, HAS_PR: { rule: 'drop' } };
  const src = {
    PART_OF: [{ r: '#e:1', o: '#s:1', i: '#s:2', props: { since: '2026' } }, { r: '#e:2', o: '#s:1', i: '#x:404', props: {} }],
    IMPLEMENTED_IN_RELEASE: [{ r: '#e:3', o: '#s:1', i: '#r:1', props: {} }],
    INCLUDES: [{ r: '#e:4', o: '#r:1', i: '#s:1', props: {} }, { r: '#e:5', o: '#r:1', i: '#s:2', props: {} }],
    HAS_PR: [{ r: '#e:6', o: '#s:1', i: '#s:2', props: {} }],
  };
  const w = edgeWrites(src, dstRid, plan);
  assert.deepEqual(w.writes.PART_OF, [{ from: '#d:1', to: '#d:2', content: { since: '2026', mig_src_rid: '#e:1' } }]);
  assert.equal(w.missingEnds.PART_OF, 1, 'конец не перенесён — в отчёт, не в базу');
  assert.deepEqual(w.writes.IMPLEMENTED_IN_RELEASE.map(x => x.from + '>' + x.to), ['#d:1>#d:9', '#d:2>#d:9'], 'пара #s:1>#r:1 уже есть — дубля нет');
  assert.equal(w.duplicates.INCLUDES, 1);
  assert.equal(w.writes.HAS_PR, undefined);
});

test('параллельные связи keep не схлопываются: задача → человек как автор и как исполнитель', async () => {
  const { edgeWrites } = await import('./edge-plan.mjs');
  const dstRid = new Map([['#t:1', '#d:1'], ['#u:1', '#d:2']]);
  const w = edgeWrites({ ROLE_HELD_BY: [
    { r: '#e:1', o: '#t:1', i: '#u:1', props: { role: 'author' } },
    { r: '#e:2', o: '#t:1', i: '#u:1', props: { role: 'executor' } },
  ] }, dstRid, { ROLE_HELD_BY: { rule: 'keep' } });
  assert.deepEqual(w.writes.ROLE_HELD_BY.map(x => x.content.role), ['author', 'executor']);
  assert.equal(w.duplicates.ROLE_HELD_BY, undefined);
});
