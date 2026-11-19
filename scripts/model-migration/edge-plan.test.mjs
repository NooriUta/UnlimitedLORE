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

test('решения владелицы: HAS_PR не переносится; связи снятой план-доски не переносятся', () => {
  const p = edgePlan(TRIPLES, ALL.edges, TYPES);
  assert.equal(p.HAS_PR.rule, 'drop');
  assert.equal(p.ON_MILESTONE.rule, 'drop');
  assert.match(p.ON_MILESTONE.why, /PlanCheckpoint/);
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
