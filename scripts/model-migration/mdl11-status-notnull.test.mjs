// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-11 · ответ владелицы 19.11.2026 «5а»: в схеме 1.18 пустой статус у версии
// задачи запрещён на уровне базы (MANDATORY + NOTNULL).
//
// Цепочка одна, и каждое звено проверяется здесь:
//   модель (shared/model/lore-model.json, task.status — notnull) → схема переноса (schema/*.json, поле версии
//   с notnull) → DDL 1.18 (ddlProperty с ограничением) → перенос даёт статус всем (пустой — по решению
//   человека, для LORE это ST-08 → BACKLOG) → перед записью сторож: версия без обязательного поля не пишется.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyMap } from './apply-map.mjs';
import { notNullOfModel } from './notnull.mjs';

const J = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const MODEL = J('../../shared/model/lore-model.json');
const SCHEMA = { ...J('./schema/sprint-phase-task.json').types, ...J('./schema/all-objects.json').types };
const MAP = J('./map/sprint-phase-task.json').types;
const RULES = J('./rules/status-unification.json');
const DECISIONS = J('./rules/decisions.lore.json'); // решения, с которыми установщик переносит LORE
const DRY = J('./tools/census/dry-all.json').types; // перепись сухого прогона по снимку прода
const STATUSES = J('../../shared/lore-statuses.json');

// тот же контекст исполнителя, что у transfer.mjs для версии задачи (справочник — из правил: база не нужна)
const ctx = { statusDict: 'task_status', statusVocab: STATUSES.statusMatch, canonToCode: { in_progress: 'active' }, decisions: DECISIONS, codeCase: RULES.code_case.status, statusRules: RULES.dictionaries.plan_status };

test('модель: статус задачи обязателен на уровне базы (notnull)', () => {
  const task = MODEL.types.find(t => t.type === 'task');
  const f = task.fields.find(x => x.key === 'status');
  assert.equal(f.notnull, true);
  assert.equal(f.historic, true, 'статус живёт в версии — ограничение ложится на KnowTaskHist');
});

test('схема 1.18 выводится из модели: notnull у поля версии ⇔ notnull в модели', () => {
  const want = notNullOfModel(MODEL);
  assert.deepEqual(want, { KnowTaskHist: ['status'] }, 'по слову владелицы — пока только статус версии задачи');
  const got = {};
  for (const [T, t] of Object.entries(SCHEMA)) for (const [f, e] of Object.entries(t.fields)) if (e.notnull) (got[T] ||= []).push(f);
  assert.deepEqual(got, want);
});

test('DDL 1.18: обязательное поле объявляется с MANDATORY и NOTNULL, прочие — как были', async () => {
  const { ddlProperty, schemaDdl } = await import('./transfer.mjs');
  assert.equal(ddlProperty('KnowTaskHist', 'status', 'STRING', { notnull: true }), 'CREATE PROPERTY KnowTaskHist.`status` STRING (MANDATORY true, NOTNULL true)');
  assert.equal(ddlProperty('KnowTaskHist', 'status_note', 'STRING'), 'CREATE PROPERTY KnowTaskHist.`status_note` STRING');
  const ddl = schemaDdl('KnowTaskHist', SCHEMA.KnowTaskHist);
  assert.ok(ddl.includes('CREATE PROPERTY KnowTaskHist.`status` STRING (MANDATORY true, NOTNULL true)'), ddl.join('\n'));
  assert.equal(ddl.filter(s => /MANDATORY/.test(s)).length, 1);
  assert.ok(!schemaDdl('KnowSprintHist', SCHEMA.KnowSprintHist).some(s => /MANDATORY/.test(s)), 'статус спринта не тронут: владелица решила только про задачу');
});

test('перенос: версия задачи без статуса получает BACKLOG по решению ST-08 — и при пустой строке, и без поля', () => {
  for (const rec of [{ state_uid: 'u1' }, { state_uid: 'u2', status_raw: '' }, { state_uid: 'u3', status_raw: null }]) {
    const r = applyMap('KnowTaskHist', MAP.KnowTaskHist, rec, ctx);
    assert.equal(r.out.status, 'BACKLOG', JSON.stringify(rec));
    assert.deepEqual(r.rejects, []);
    assert.deepEqual(r.decided.map(d => d.decision), ['ST-08']);
  }
});

test('перенос: без решения о пустом статусе пустота не прячется — несоответствие «пусто» в остатке', () => {
  const r = applyMap('KnowTaskHist', MAP.KnowTaskHist, { state_uid: 'u1' }, { ...ctx, decisions: undefined });
  assert.ok(!('status' in r.out));
  assert.deepEqual(r.rejects, [{ field: 'status_raw', value: '', why: 'пусто' }]);
});

test('перенос: заданный статус не трогается — ни решением о пустоте, ни сторожем', () => {
  const r = applyMap('KnowTaskHist', MAP.KnowTaskHist, { state_uid: 'u1', status_raw: '✅ DONE' }, ctx);
  assert.equal(r.out.status, 'DONE');
  assert.deepEqual(r.rejects, []);
});

test('сторож перед записью: версия без обязательного поля называется поимённо, запись не начинается', async () => {
  const { notNullMissing } = await import('./transfer.mjs');
  const calc = { KnowTaskHist: [{ rid: '#1:1', res: { out: { status: 'DONE' } } }, { rid: '#1:2', res: { out: {} } }, { rid: '#1:3', res: { out: { status: '' } } }], KnowSprintHist: [{ rid: '#2:1', res: { out: {} } }] };
  assert.deepEqual(notNullMissing(calc, SCHEMA), [{ type: 'KnowTaskHist', field: 'status', rids: ['#1:2', '#1:3'] }]);
  assert.deepEqual(notNullMissing({ KnowTaskHist: [{ rid: '#1:1', res: { out: { status: 'BACKLOG' } } }] }, SCHEMA), []);
});

test('данные установщика: на переписи прода пустые статусы версий задач все покрыты ST-08, вне справочника — нет', () => {
  const t = DRY.KnowTaskHist;
  const empty = t.records - t.outFields.status;
  assert.ok(empty > 0, 'положительный контроль: в переписи есть версии без статуса');
  const st08 = DECISIONS.decisions.find(d => d.id === 'ST-08');
  assert.deepEqual([st08.scope, st08.action, st08.to], [{ type: 'KnowTaskHist', field: 'status_raw', why: 'пусто' }, 'map_to', 'BACKLOG']);
  assert.match(st08.note, new RegExp(`записей ${empty}\\b`), 'решение принято на то же число пустых, что в переписи');
  assert.deepEqual(t.rejects, {}, 'статусов вне справочника нет — после ST-08 версий без статуса 0');
  assert.ok(RULES.dictionaries.plan_status.codes.some(c => c.code === 'BACKLOG'), 'BACKLOG есть в справочнике');
});
