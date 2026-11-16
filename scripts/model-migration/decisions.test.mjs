// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — решения человека о несоответствиях данных.
// Слова владелицы 16.11.2026: решения «должны быть через интерфейс миграции», потому что у другой установки
// несоответствия будут свои. Поэтому перечень несоответствий не зашит в карту: перенос находит их по данным,
// а файл решений хранит только то, что человек решил, — и переносится на другую установку как есть.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyMap } from './apply-map.mjs';
import { checkDecisions, resolveRejects, FORMAT } from './decisions.mjs';

const MAP = JSON.parse(fs.readFileSync(new URL('./map/sprint-phase-task.json', import.meta.url), 'utf8')).types;
const ctx = { statusCodes: { sprint: ['planned', 'in_progress', 'done', 'cancelled', 'blocked'] }, statusDict: 'sprint' };
const D = (over) => ({ id: 'd1', scope: { type: 'KnowSprintHist', field: 'priority', value: 'medium' }, action: 'map_to', to: 'normal', by: 'omiloreadmin', at: '2026-11-16T10:00:00Z', ...over });
const doc = (...decisions) => ({ format: FORMAT, decisions });
const run = (record, decisions) => applyMap('KnowSprintHist', MAP.KnowSprintHist, record, { ...ctx, decisions: decisions ? doc(...decisions) : undefined });

test('положительный контроль: без решений значение вне шкалы остаётся несоответствием', () => {
  const r = run({ priority: 'medium' });
  assert.equal(r.rejects.length, 1);
  assert.equal(r.rejects[0].why, 'приоритет вне шкалы');
  assert.equal(r.out.priority, undefined);
});

test('«свести к коду»: значение записано, несоответствие снято и названо в принятых', () => {
  const r = run({ priority: 'medium' }, [D()]);
  assert.equal(r.out.priority, 'normal');
  assert.deepEqual(r.rejects, []);
  assert.deepEqual(r.decided, [{ field: 'priority', value: 'medium', decision: 'd1', action: 'map_to' }]);
});

test('решение действует только на своё значение: соседнее остаётся несоответствием', () => {
  const r = run({ priority: '🟡 MEDIUM' }, [D()]);
  assert.equal(r.rejects.length, 1);
  assert.equal(r.out.priority, undefined);
});

test('«текст в заметку»: поле пустое, исходное значение не потеряно', () => {
  const r = run({ priority: '🟡 MEDIUM (исследовательский)' }, [D({ scope: { type: 'KnowSprintHist', field: 'priority', value: '🟡 MEDIUM (исследовательский)' }, action: 'to_note', to: undefined })]);
  assert.equal(r.out.priority, undefined);
  assert.equal(r.out.priority_note, '🟡 MEDIUM (исследовательский)');
  assert.deepEqual(r.rejects, []);
});

test('«не переносить»: несоответствие снято, значение названо в принятых — молча не пропадает', () => {
  const r = run({ priority: 'medium' }, [D({ action: 'drop', to: undefined })]);
  assert.equal(r.out.priority, undefined);
  assert.deepEqual(r.rejects, []);
  assert.equal(r.decided[0].action, 'drop');
});

test('«решу позже»: несоответствие остаётся, но помечено отложенным', () => {
  const r = run({ priority: 'medium' }, [D({ action: 'defer', to: undefined })]);
  assert.equal(r.rejects.length, 1);
  assert.equal(r.rejects[0].deferred, 'd1');
});

test('решение без значения — на всё поле с этой причиной', () => {
  const r = run({ priority: 'что угодно' }, [D({ scope: { type: 'KnowSprintHist', field: 'priority', why: 'приоритет вне шкалы' }, action: 'drop', to: undefined })]);
  assert.deepEqual(r.rejects, []);
});

test('файл решений проверяется: формат, действие, автор, цель, повтор области', () => {
  assert.deepEqual(checkDecisions(doc(D())), []);
  assert.match(checkDecisions({ format: 'другое', decisions: [] })[0], /формат/);
  assert.match(checkDecisions(doc(D({ action: 'угадать' })))[0], /действие/);
  assert.match(checkDecisions(doc(D({ by: '' })))[0], /кто принял/);
  assert.match(checkDecisions(doc(D({ to: undefined })))[0], /к какому значению/);
  assert.match(checkDecisions(doc(D({ scope: { type: 'KnowSprintHist', field: 'priority' } })))[0], /значение или причина/);
  assert.match(checkDecisions(doc(D(), D({ id: 'd2', to: 'low' })))[0], /два решения/);
});

test('«текст в заметку» там, где заметки у поля нет, — отказ, а не тихая потеря', () => {
  const r = { out: {}, toVersion: {}, rejects: [{ field: 'created_date', value: 'июнь', why: 'не дата', target: { bucket: 'out', field: 'created_at' } }] };
  assert.throws(() => resolveRejects('KnowSprint', r, doc(D({ scope: { type: 'KnowSprint', field: 'created_date', value: 'июнь' }, action: 'to_note', to: undefined }))), /заметки/);
});

test('файла решений нет — решений нет; негодный файл — отказ, а не «решений нет»', async () => {
  const { loadDecisions } = await import('./decisions.mjs');
  const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-dec-'));
  assert.equal(loadDecisions(path.join(dir, 'нет.json')), undefined);
  const good = path.join(dir, 'good.json'); fs.writeFileSync(good, JSON.stringify(doc(D())));
  assert.equal(loadDecisions(good).decisions.length, 1);
  const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, JSON.stringify(doc(D({ action: 'угадать' }))));
  assert.throws(() => loadDecisions(bad), /не принят/);
});

test('add_code: добавляемый код статуса — действие файла решений; без подписей файл не принимается', () => {
  const ok = { format: FORMAT, decisions: [{ id: 'A1', scope: { type: 'KnowADRHist', field: 'status_raw', value: 'REJECTED' }, action: 'add_code', to: 'rejected',
    labels: { ru: 'Отклонён', en: 'Rejected', pl: 'Odrzucony' }, by: 'владелица', at: '2026-11-16T12:00:00Z' }] };
  assert.deepEqual(checkDecisions(ok), []);
  const bad = structuredClone(ok);
  delete bad.decisions[0].labels;
  assert.match(checkDecisions(bad).join('; '), /A1.*нет подписей/);
});
