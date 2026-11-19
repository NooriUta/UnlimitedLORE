// SPRINT_LORE_MODEL_DOCS_TIDY/MD-02 · «Что выключаем» — список устаревших и правило переноса из заметки задачи.
// Правило (заметка 15.11 и 18.11): снятие идёт картой переноса MIG-01, а не шагом V; «что нужно в QG то и оставляй».
// Сторож: каждый пункт списка либо не переносится (тип — в NOT_MOVED, связь — drop/convert, поле — drop) с причиной,
// либо переносится по явному решению владелицы. Тихо «как есть» не уходит ничего из списка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP, NOT_MOVED, EDGES } from './resources.mjs';
import { structurePlan } from './structure-plan.mjs';
import { edgePlan } from './edge-plan.mjs';
import loreModel from '../../shared/model/lore-model.json' with { type: 'json' };

// Сняты V89 (#1401): легаси-словари статусов, вид трека и связи к ним. Источник без V89 не должен нести их «как есть».
const RETIRED_TYPES = ['StatusAdr', 'StatusDecision', 'StatusMilestone', 'StatusPhase', 'StatusSprint', 'StatusTask', 'TrackType'];
const RETIRED_EDGES = ['HAS_STATUS', 'OF_TYPE'];
// План-доска снята (D-2026-LORE-PLAN-BOARD-REMOVED).
const PLAN_TYPES = ['PlanCheckpoint', 'PlanConfig', 'PlanSection', 'PlanTrack', 'PlanVersion'];
// Владелица: HAS_PR не переносится; ON_MILESTONE — от плана-доски.
const DROPPED_EDGES = ['HAS_PR', 'ON_MILESTONE'];
// Мёртвые связи — переводятся в живую IMPLEMENTED_IN_RELEASE, под своим именем не переносятся.
const CONVERTED_EDGES = ['INCLUDES', 'RELEASED_IN'];
// «что нужно в QG то и оставляй» (18.11) и «матрица технологий переносится» (18.11) — переносятся.
const KEPT_TYPES = ['ClRoutineRun', 'ClRoutineMetric', 'ClRoutineOutput', 'ClRoutineSprintFlag', 'KnowFindingHist', 'LoreTechnology'];
const KEPT_EDGES = ['ClRoutineHasOutput'];

test('MD-02: снятые V89 типы и план-доска — в «не переносится» с причиной', () => {
  for (const t of [...RETIRED_TYPES, ...PLAN_TYPES]) {
    assert.ok(NOT_MOVED[t], `${t} должен быть в NOT_MOVED`);
    assert.ok(String(NOT_MOVED[t]).length > 10, `${t}: причина обязательна`);
    assert.ok(!MAP[t], `${t} не должен быть в карте переноса`);
  }
});

test('MD-02: снятые связи — drop с причиной, мёртвые — convert в IMPLEMENTED_IN_RELEASE', () => {
  for (const e of [...RETIRED_EDGES, ...DROPPED_EDGES]) {
    assert.equal(EDGES[e] && EDGES[e].rule, 'drop', `${e}: правило drop`);
    assert.ok(EDGES[e].note, `${e}: причина обязательна`);
  }
  for (const e of CONVERTED_EDGES) {
    assert.equal(EDGES[e].rule, 'convert');
    assert.equal(EDGES[e].to, 'IMPLEMENTED_IN_RELEASE');
  }
});

test('MD-02: оставленное по слову владелицы переносится', () => {
  for (const t of KEPT_TYPES) assert.ok(MAP[t], `${t} в карте переноса`);
  for (const e of KEPT_EDGES) assert.equal(EDGES[e].rule, 'keep');
  // rationale_md решения и decisions_md вехи читают паспорта — остаются в модели 1.18 (в проде они пусты, переносить
  // из них нечего; если значение появится, его не дропнет ни одно правило карты)
  const inModel = (type, key) => JSON.stringify(loreModel.types.find(t => t.type === type)).includes(`"key":"${key}"`);
  assert.ok(inModel('decision', 'rationale_md'), 'decision.rationale_md в модели');
  assert.ok(inModel('milestone', 'decisions_md'), 'milestone.decisions_md в модели');
  for (const t of ['KnowDecision', 'KnowMilestone']) for (const f of ['rationale_md', 'decisions_md'])
    assert.notEqual(MAP[t][f] && MAP[t][f].rule, 'drop', `${t}.${f} не снимается`);
});

test('MD-02: поле status_category не переносится нигде', () => {
  for (const [t, fs] of Object.entries(MAP)) if (fs.status_category) assert.equal(fs.status_category.rule, 'drop', t);
});

test('MD-02: источник без V89 — Status*/TrackType не воссоздаются, а уходят в отчёт с причиной', () => {
  const src = RETIRED_TYPES.map(name => ({ name, type: 'vertex', properties: [{ name: 'status_id', type: 'STRING' }], indexes: [] }));
  const plan = structurePlan(src, {}, NOT_MOVED);
  assert.deepEqual(plan.types, []);
  assert.deepEqual(plan.notCarried.map(x => x.type).sort(), [...RETIRED_TYPES].sort());
  for (const x of plan.notCarried) assert.ok(x.why);
});

test('MD-02: связи HAS_STATUS / OF_TYPE в источнике не роняют перенос и не переносятся', () => {
  const triples = [
    { edge: 'HAS_STATUS', from: 'KnowSprintHist', to: 'StatusSprint', n: 5 },
    { edge: 'OF_TYPE', from: 'PlanTrack', to: 'TrackType', n: 2 },
  ];
  const plan = edgePlan(triples, EDGES, new Set(['KnowSprintHist']));
  assert.equal(plan.HAS_STATUS.rule, 'drop');
  assert.equal(plan.OF_TYPE.rule, 'drop');
});
