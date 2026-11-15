// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 — исполнитель карты переноса: одна запись старой базы → запись новой.
// Правило владелицы: ничего не теряется молча. Значение, которое перенос не смог привести, и поле без
// решения не пропадают, а уходят в отчёт (rejects / held) вместе с исходным значением.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyMap, toDate, toDateTime, toPriority, splitStatus } from './apply-map.mjs';

const MAP = JSON.parse(fs.readFileSync(new URL('./map/sprint-phase-task.json', import.meta.url), 'utf8')).types;
const STATUS = { sprint: ['planned', 'in_progress', 'done', 'cancelled', 'blocked'], phase: ['planned', 'in_progress', 'done'] };
const ctx = { statusCodes: STATUS };

test('дата: три формата прода сводятся к ГГГГ-ММ-ДД, мусор не угадывается', () => {
  assert.equal(toDate('2026-06-04'), '2026-06-04');
  assert.equal(toDate('2026-06-04T10:11:12Z'), '2026-06-04');
  assert.equal(toDate('04.06.2026'), '2026-06-04');
  assert.equal(toDate('июнь'), null);
  assert.equal(toDate('2026-13-40'), null);
});

test('момент: к ISO-8601 в UTC; дата без времени — полночь UTC', () => {
  assert.equal(toDateTime('2026-06-04T10:11:12+03:00'), '2026-06-04T07:11:12.000Z');
  assert.equal(toDateTime('2026-06-04'), '2026-06-04T00:00:00.000Z');
  assert.equal(toDateTime('вчера'), null);
});

test('приоритет: шкала P0–P3 и blocker → словесная; значок и приписка уходят в заметку', () => {
  assert.deepEqual(toPriority('P0'), { value: 'critical', note: '' });
  assert.deepEqual(toPriority('🔴 P0'), { value: 'critical', note: '' });
  assert.deepEqual(toPriority('blocker'), { value: 'critical', note: '' });
  assert.deepEqual(toPriority('high'), { value: 'high', note: '' });
  assert.deepEqual(toPriority('🟡 MEDIUM (observability UX) / 🟢 LOW'), { value: null, note: '🟡 MEDIUM (observability UX) / 🟢 LOW' });
  assert.deepEqual(toPriority('P1 — после релиза'), { value: 'high', note: 'после релиза' });
});

test('статус: код из справочника строчными, приписка — отдельно', () => {
  assert.deepEqual(splitStatus('✅ DONE', STATUS.sprint), { code: 'done', note: '' });
  assert.deepEqual(splitStatus('🔄 IN PROGRESS', STATUS.sprint), { code: 'in_progress', note: '' });
  assert.deepEqual(splitStatus('✅ DONE — PROD 2026-06-04 v1.4.6', STATUS.sprint), { code: 'done', note: 'PROD 2026-06-04 v1.4.6' });
  assert.deepEqual(splitStatus('Alert Engine', STATUS.sprint), { code: null, note: 'Alert Engine' });
});

test('спринт: name → title, название, равное коду, становится пустым; ключ остаётся', () => {
  const a = applyMap('KnowSprint', MAP.KnowSprint, { sprint_id: 'SPRINT_X', name: 'SPRINT_X' }, ctx);
  assert.equal(a.out.sprint_id, 'SPRINT_X');
  assert.equal(a.out.title, null);
  const b = applyMap('KnowSprint', MAP.KnowSprint, { sprint_id: 'SPRINT_X', name: 'Переезд модели' }, ctx);
  assert.equal(b.out.title, 'Переезд модели');
  assert.ok(!('name' in b.out));
});

test('спринт: created_date и date_created дают одно created_at', () => {
  assert.equal(applyMap('KnowSprint', MAP.KnowSprint, { sprint_id: 'S', created_date: '04.06.2026' }, ctx).out.created_at, '2026-06-04');
  assert.equal(applyMap('KnowSprint', MAP.KnowSprint, { sprint_id: 'S', date_created: '2026-06-05' }, ctx).out.created_at, '2026-06-05');
});

test('значение с записи для текущей версии не кладётся на запись, а отдаётся отдельно', () => {
  const r = applyMap('KnowSprint', MAP.KnowSprint, { sprint_id: 'S', context_md: 'зачем', priority: 'P1' }, ctx);
  assert.ok(!('context_md' in r.out));
  assert.equal(r.toVersion.context_md, 'зачем');
  assert.equal(r.toVersion.priority, 'high');
});

test('версия спринта: статус → код и заметка к статусу', () => {
  const r = applyMap('KnowSprintHist', MAP.KnowSprintHist, { status_raw: '✅ DONE — PROD v1.4.6', valid_from: '2026-06-04T10:00:00Z' }, { statusCodes: STATUS, statusDict: 'sprint' });
  assert.equal(r.out.status, 'done');
  assert.equal(r.out.status_note, 'PROD v1.4.6');
  assert.ok(!('status_raw' in r.out));
});

test('фаза: подпись «Фаза» из кода убирается; не-статус версии уходит в название', () => {
  assert.equal(applyMap('KnowPhase', MAP.KnowPhase, { phase_id: 'Фаза 3', name: 'Сборка' }, ctx).out.phase_id, '3');
  const r = applyMap('KnowPhaseHist', MAP.KnowPhaseHist, { status_raw: 'Alert Engine' }, { statusCodes: STATUS, statusDict: 'phase' });
  assert.equal(r.out.status, null);
  assert.equal(r.titleFallback, 'Alert Engine');
});

test('снимаемое поле названо в dropped, а не исчезает без следа', () => {
  const r = applyMap('KnowSprintHist', MAP.KnowSprintHist, { planned_milestone_id: 'M1' }, { statusCodes: STATUS, statusDict: 'sprint' });
  assert.ok(!('planned_milestone_id' in r.out));
  assert.deepEqual(r.dropped, ['planned_milestone_id']);
});

test('нерешённое поле и несогласованное преобразование удерживаются с исходным значением', () => {
  const r = applyMap('KnowSprint', MAP.KnowSprint, { sprint_id: 'S', version: '2', pr_refs: '#101, #102' }, ctx);
  assert.equal(r.held.version, '2');
  assert.equal(r.held.pr_refs, '#101, #102');
  assert.ok(!('version' in r.out) && !('pr_refs' in r.out));
});

test('значение, которое не удалось привести, попадает в rejects, а не в null молча', () => {
  const r = applyMap('KnowSprint', MAP.KnowSprint, { sprint_id: 'S', created_date: 'июнь' }, ctx);
  assert.deepEqual(r.rejects, [{ field: 'created_date', value: 'июнь', why: 'не дата' }]);
});

test('поле записи, которого нет в карте, — ошибка, а не тихий пропуск', () => {
  assert.throws(() => applyMap('KnowSprint', MAP.KnowSprint, { sprint_id: 'S', brand_new_field: 1 }, ctx), /brand_new_field/);
});

test('служебные поля движка (@rid, @type, @cat) в карту не входят и не переносятся', () => {
  const r = applyMap('KnowSprint', MAP.KnowSprint, { '@rid': '#1:0', '@type': 'KnowSprint', '@cat': 'v', sprint_id: 'S' }, ctx);
  assert.deepEqual(Object.keys(r.out), ['sprint_id']);
});

test('сторож: у каждого согласованного преобразования карты есть код', async () => {
  const { missingTransforms } = await import('./apply-map.mjs');
  assert.deepEqual(missingTransforms(MAP), []);
  assert.deepEqual(missingTransforms({ KnowX: { a: { rule: 'transform', basis: 'owner' } } }), ['KnowX.a']);
});
