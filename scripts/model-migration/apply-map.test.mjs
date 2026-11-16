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
  assert.deepEqual(toPriority('🟡 MEDIUM (observability UX) / 🟢 LOW'), { value: 'normal', note: '(observability UX) / 🟢 LOW' });
  // 16.11.2026: medium — середина шкалы, то же, что normal (решение ST-74 на приёмке; «одна шкала приоритета»)
  assert.deepEqual(toPriority('medium'), { value: 'normal', note: '' });
  assert.deepEqual(toPriority('что угодно'), { value: null, note: 'что угодно' });
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
  // version решено 16.11 (delegated: keep); pr_refs — преобразование без согласованного кода, удерживается
  const r = applyMap('KnowSprint', MAP.KnowSprint, { sprint_id: 'S', version: '2', pr_refs: '#101, #102' }, ctx);
  assert.equal(r.held.pr_refs, '#101, #102');
  assert.ok(!('pr_refs' in r.out));
  assert.equal(r.out.version, '2', 'решённое поле переносится');
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

// ── Статус по каноническому словарю приложения (shared/lore-statuses.json, statusMatch) ──────────────
const VOCAB = JSON.parse(fs.readFileSync(new URL('../../shared/lore-statuses.json', import.meta.url), 'utf8')).statusMatch;
const DICT = ['active', 'backlog', 'blocked', 'cancelled', 'design', 'done', 'failed', 'partial', 'planned', 'ready_for_deploy', 'review', 'todo', 'uat', 'waiting'];
const sv = { vocab: VOCAB, codes: DICT, canonToCode: { in_progress: 'active' } };

test('словарь приложения: написания прода сводятся к коду справочника', async () => {
  const { classifyStatus } = await import('./apply-map.mjs');
  assert.deepEqual(classifyStatus('🔄 IN PROGRESS', sv), { code: 'active', note: '' });
  assert.deepEqual(classifyStatus('🧪 UAT TESTING', sv), { code: 'uat', note: '' });
  assert.deepEqual(classifyStatus('🚀 READY FOR DEPLOY', sv), { code: 'ready_for_deploy', note: '' });
  assert.deepEqual(classifyStatus('IN_PROGRESS', sv), { code: 'active', note: '' });
  assert.deepEqual(classifyStatus('✅ DONE — PROD 2026-06-04 v1.4.6', sv), { code: 'done', note: 'PROD 2026-06-04 v1.4.6' });
});

test('словарь приложения: нестандартное написание опознаётся, но целиком сохраняется в приписке', async () => {
  const { classifyStatus } = await import('./apply-map.mjs');
  assert.deepEqual(classifyStatus('✅ FULLY CLOSED', sv), { code: 'done', note: 'FULLY CLOSED' });
  assert.deepEqual(classifyStatus('MERGED 02.05.2026**', sv), { code: 'done', note: 'MERGED 02.05.2026**' });
});

test('словарь приложения: неузнанное и канон без кода в справочнике — без кода, текст в приписке', async () => {
  const { classifyStatus } = await import('./apply-map.mjs');
  assert.deepEqual(classifyStatus('STUB', sv), { code: null, note: 'STUB' });
  assert.deepEqual(classifyStatus('⏸ DEFERRED', sv), { code: null, note: 'DEFERRED', known: true, canon: 'deferred' }); // статус опознан, но кода deferred в справочнике нет
  assert.deepEqual(classifyStatus('P0', sv), { code: null, note: 'P0' });
});

test('фаза: статусом считается только точное написание; заголовок со словом-статусом остаётся заголовком', async () => {
  const { classifyStatus } = await import('./apply-map.mjs');
  const ph = { ...sv, codes: ['active', 'backlog', 'done', 'moved', 'planned'], strict: true };
  assert.deepEqual(classifyStatus('📋 PLANNED', ph), { code: 'planned', note: '' });
  assert.deepEqual(classifyStatus('ДЕПЛОЙ + ACTIVATION', ph), { code: null, note: 'ДЕПЛОЙ + ACTIVATION' });
  assert.deepEqual(classifyStatus('Documentation foundation', ph), { code: null, note: 'Documentation foundation' });
});

test('фаза: настоящий статус, которого нет в справочнике фаз, — отказ, а не «название»', () => {
  const c = { statusCodes: { phase_status: ['active', 'backlog', 'done', 'moved', 'planned'] }, statusDict: 'phase_status', statusVocab: VOCAB, canonToCode: { in_progress: 'active' } };
  const partial = applyMap('KnowPhaseHist', MAP.KnowPhaseHist, { status_raw: '🟡 PARTIAL' }, c);
  assert.equal(partial.titleFallback, null);
  assert.deepEqual(partial.rejects, [{ field: 'status_raw', value: '🟡 PARTIAL', why: 'статус вне справочника' }]);
  const title = applyMap('KnowPhaseHist', MAP.KnowPhaseHist, { status_raw: 'Alert Engine' }, c);
  assert.equal(title.titleFallback, 'Alert Engine');
  assert.deepEqual(title.rejects, []);
});

test('служебные моменты версии приводятся к настоящему виду, даже если само поле — предложение', () => {
  const c = { statusCodes: { sprint_status: DICT }, statusDict: 'sprint_status', statusVocab: VOCAB, canonToCode: { in_progress: 'active' } };
  const r = applyMap('KnowSprintHist', MAP.KnowSprintHist, { valid_from: '2026-06-04T10:00:00+03:00', valid_to: '2026-06-05', status_known_from: '2026-06-04T07:00:00Z' }, c);
  assert.equal(r.out.valid_from, '2026-06-04T07:00:00.000Z');
  assert.equal(r.out.valid_to, '2026-06-05T00:00:00.000Z');
  assert.equal(r.out.status_known_from, '2026-06-04T07:00:00.000Z');
  assert.deepEqual(r.held, {});
  const bad = applyMap('KnowSprintHist', MAP.KnowSprintHist, { valid_from: 'давно' }, c);
  assert.deepEqual(bad.rejects, [{ field: 'valid_from', value: 'давно', why: 'не момент времени' }]);
});

test('код статуса пишется в регистре правил: codeCase upper — заглавными, без него — как в справочнике', () => {
  const base = { statusCodes: STATUS, statusDict: 'sprint' };
  const row = { status_raw: '✅ DONE — PROD v1.4.6', valid_from: '2026-06-04T10:00:00Z' };
  assert.equal(applyMap('KnowSprintHist', MAP.KnowSprintHist, row, { ...base, codeCase: 'upper' }).out.status, 'DONE');
  assert.equal(applyMap('KnowSprintHist', MAP.KnowSprintHist, row, base).out.status, 'done');
});

test('фаза: статус задачи в истории фазы сводится к коду фазы по правилу «статус фазы по задачам» (16.11.2026)', () => {
  const phaseStatusMap = { PARTIAL: 'ACTIVE', READY_FOR_DEPLOY: 'ACTIVE', BLOCKED: 'ACTIVE', DONE: 'DONE' };
  const c = { statusCodes: { phase_status: ['ACTIVE', 'BACKLOG', 'DONE', 'MOVED', 'PLANNED'] }, statusDict: 'phase_status', statusVocab: VOCAB, canonToCode: { in_progress: 'active' }, codeCase: 'upper', phaseStatusMap };
  const partial = applyMap('KnowPhaseHist', MAP.KnowPhaseHist, { status_raw: '🟡 PARTIAL' }, c);
  assert.equal(partial.out.status, 'ACTIVE');
  assert.match(partial.out.status_note, /PARTIAL/, 'прежний статус не теряется — в приписке');
  assert.deepEqual(partial.rejects, []);
  const rfd = applyMap('KnowPhaseHist', MAP.KnowPhaseHist, { status_raw: '🚀 READY FOR DEPLOY' }, c);
  assert.equal(rfd.out.status, 'ACTIVE');
  // отменённой фазы в правиле нет — остаётся на решение человека, молча не сводится
  const cancelled = applyMap('KnowPhaseHist', MAP.KnowPhaseHist, { status_raw: '🚫 CANCELLED' }, c);
  assert.deepEqual(cancelled.rejects, [{ field: 'status_raw', value: '🚫 CANCELLED', why: 'статус вне справочника' }]);
});

test('основание «delegated» (владелица поручила решить, 16.11.2026) действует как её решение', () => {
  const map = { priority: { rule: 'transform', to: 'priority', how: 'словесная шкала', basis: 'delegated' } };
  const r = applyMap('KnowTask', map, { priority: 'Medium (не блокер)' }, { statusCodes: {}, statusDict: null });
  assert.deepEqual(r.held, {}, 'решение «delegated» не держит поле');
  assert.equal(r.out.priority, 'normal');
  assert.equal(r.out.priority_note, '(не блокер)');
});
