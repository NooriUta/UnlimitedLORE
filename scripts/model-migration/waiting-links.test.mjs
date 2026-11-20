// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Шаг мастера «Ожидание → связи»: текст waiting_for задачи («чьего ответа ждём»).
// Владелица 20.11.2026: «ок связь где можно где нет текст». Где текст однозначно называет запись планирования LORE —
// задачу (SPRINT_X/CODE), фазу, спринт, веху, в том числе в форме [[…]] и тип:код, — мастер предлагает связь
// DEPENDS_ON вида waits с причиной = исходный текст. Где не называет (или называет ADR, решение — не планирование,
// их связь «зависит от» не соединяет) — остаётся текстом. Текст поля не стирается в любом случае.
import test from 'node:test';
import assert from 'node:assert/strict';
import { refsIn, proposeWaitingLinks, waitingLinkAnswers, withWaitingLinks, waitingLinkState, WAIT_KIND } from './waiting-links.mjs';

const REG = {
  tasks: ['SPRINT_A/T1', 'SPRINT_A/T2', 'SPRINT_B/QG-04'],
  phases: ['SPRINT_B/PHASE_1'],
  sprints: ['SPRINT_A', 'SPRINT_B', 'SPRINT_MINILORE_POLISH'],
  milestones: ['M-1'],
};

test('ссылки в тексте: код задачи, [[…]], тип:код, спринт, веха; ADR и решение — не планирование', () => {
  assert.deepEqual(refsIn('ждём SPRINT_B/QG-04 и [[task:SPRINT_A/T2]]', REG).targets, [
    { type: 'task', id: 'SPRINT_B/QG-04' }, { type: 'task', id: 'SPRINT_A/T2' }]);
  assert.deepEqual(refsIn('после спринта SPRINT_MINILORE_POLISH', REG).targets, [{ type: 'sprint', id: 'SPRINT_MINILORE_POLISH' }]);
  assert.deepEqual(refsIn('фаза SPRINT_B/PHASE_1, веха [[M-1]]', REG).targets, [{ type: 'phase', id: 'SPRINT_B/PHASE_1' }, { type: 'milestone', id: 'M-1' }]);
  const adr = refsIn('ответ владелицы по ADR-LORE-038 и D-2026-LORE-X', REG);
  assert.deepEqual(adr.targets, []);
  assert.deepEqual(adr.other, ['ADR-LORE-038', 'D-2026-LORE-X']);
  assert.deepEqual(refsIn('SPRINT_A/T9 нет в реестре', REG).targets, [], 'код, которого нет в реестре, — не связь');
  assert.deepEqual(refsIn('ответ владелицы по ELK', REG).targets, []);
});

const rows = [
  { task_uid: 'SPRINT_A/T1', waiting_for: 'ждём SPRINT_B/QG-04', status_raw: '⏳ WAITING', valid_from: '2026-11-01T00:00:00Z' },
  { task_uid: 'SPRINT_A/T2', waiting_for: 'ответ владелицы по ELK', status_raw: '⏳ WAITING', valid_from: '2026-11-02T00:00:00Z' },
  { task_uid: 'SPRINT_B/QG-04', waiting_for: 'ADR-LORE-038', status_raw: '⏳ WAITING', valid_from: '2026-11-03T00:00:00Z' },
  { task_uid: 'SPRINT_B/PHASE_X', waiting_for: 'SPRINT_A/T1', status_raw: '✅ DONE', valid_from: '2026-11-04T00:00:00Z' },
  { task_uid: 'SPRINT_A/T9', waiting_for: 'сама себя SPRINT_A/T9', status_raw: '⏳ WAITING', valid_from: '2026-11-05T00:00:00Z' },
];

test('предложения: связь там, где можно; текст — где нет; старый адресат не ждущей задачи — текстом', () => {
  const p = proposeWaitingLinks(rows, { ...REG, tasks: [...REG.tasks, 'SPRINT_A/T9'] });
  const by = Object.fromEntries(p.map(x => [x.task_uid, x]));
  assert.equal(WAIT_KIND, 'waits');
  assert.equal(by['SPRINT_A/T1'].kind, 'link');
  assert.deepEqual(by['SPRINT_A/T1'].targets, [{ type: 'task', id: 'SPRINT_B/QG-04' }]);
  assert.equal(by['SPRINT_A/T1'].reason, 'ждём SPRINT_B/QG-04', 'причина — исходный текст');
  assert.equal(by['SPRINT_A/T2'].kind, 'text');
  assert.equal(by['SPRINT_B/QG-04'].kind, 'text');
  assert.match(by['SPRINT_B/QG-04'].why, /не планирование/);
  assert.equal(by['SPRINT_B/PHASE_X'].kind, 'stale', 'статус не «ждём» — адресат прошлого статуса, связь не предлагается');
  assert.equal(by['SPRINT_A/T9'].kind, 'text', 'ссылка на себя — не связь');
});

test('ответы и итог: принять группой или по одной; без ответа — текстом, «ждёт решения»', () => {
  const p = proposeWaitingLinks(rows, REG);
  const doc = withWaitingLinks({ format: 'mig-decisions/1', decisions: [] }, { 'SPRINT_A/T1': true }, 'omiloreadmin', '2026-11-20T10:00:00Z');
  assert.deepEqual(waitingLinkAnswers(doc), { 'SPRINT_A/T1': true });
  assert.throws(() => withWaitingLinks(doc, { 'SPRINT_A/T1': 'да' }, 'x'), /true или false/);
  assert.throws(() => withWaitingLinks(doc, { 'SPRINT_A/T1': true }, ''), /кто принял/);
  const st = waitingLinkState(p, waitingLinkAnswers(doc));
  assert.deepEqual(st.links, [{ task_uid: 'SPRINT_A/T1', target: { type: 'task', id: 'SPRINT_B/QG-04' }, reason: 'ждём SPRINT_B/QG-04', valid_from: '2026-11-01T00:00:00Z' }]);
  assert.equal(st.counts.texts_with_waiting_for, 5);
  assert.equal(st.counts.became_links, 1);
  assert.equal(st.counts.stayed_text, 4);
  assert.equal(st.counts.waiting, 0, 'единственное предложение принято');
  const st0 = waitingLinkState(p, {});
  assert.equal(st0.counts.waiting, 1);
  assert.equal(st0.counts.became_links, 0);
});
