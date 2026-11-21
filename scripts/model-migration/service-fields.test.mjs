// Служебное поле версии changed_by_session — код сессии, записавшей версию (SPRINT_LORE_AGENT_OBSERVABILITY/AO-SESSION-LOG).
// Слова владелицы 16.11.2026: «в истории тех, у кого есть история, он пишет идентификатор сессии»; «с тебя изменение
// в модель текущего решения и синхронизация правил общих технических полей». В данных источника поля ещё нет, поэтому
// новая схема объявляет его сама — у каждого типа версий, служебным.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SCHEMA = JSON.parse(fs.readFileSync(new URL('./schema/sprint-phase-task.json', import.meta.url), 'utf8')).types;

test('у каждого типа версий в новой схеме есть служебное поле changed_by_session', () => {
  const hist = Object.keys(SCHEMA).filter(T => T.endsWith('Hist'));
  assert.ok(hist.length >= 3, 'типы версий найдены');
  for (const T of hist) {
    for (const k of ['changed_by_session', 'changed_by_harness', 'changed_by_harness_note', 'changed_by_machine']) {
      const f = SCHEMA[T].fields[k];
      assert.ok(f, T + '.' + k + ': поле объявлено');
      assert.equal(f.service, true, T + '.' + k + ': служебное');
      assert.equal(f.db_type, 'STRING');
    }
  }
});

test('у каждого типа версий в карте переноса есть правило «как есть» для служебных полей правки — иначе снимок после 16.11 их теряет', async () => {
  const { MAP } = await import('./resources.mjs');
  const hist = Object.keys(MAP).filter(T => T.endsWith('Hist'));
  assert.ok(hist.length >= 10, 'типы версий всех объектов');
  for (const T of hist) for (const k of ['changed_by_session', 'changed_by_harness', 'changed_by_harness_note', 'changed_by_machine'])
    assert.equal(MAP[T][k] && MAP[T][k].rule, 'keep', T + '.' + k);
});

// SPRINT_LORE_WORK_ANY_KIND/WK-01 (20.11.2026): причина правки — служебное поле версии рядом с changed_by_*.
// Сервер пишет её в версию истории (KnowDictEntryHist.change_reason — смена вида продукта с причиной); без
// объявления в схеме 1.18 поле оказалось бы вне модели. Общее правило: объявлено у каждого типа версий.
const ALL = JSON.parse(fs.readFileSync(new URL('./schema/all-objects.json', import.meta.url), 'utf8')).types;

test('change_reason — служебное поле версии в обеих схемах и правило «как есть» в карте', async () => {
  const { MAP } = await import('./resources.mjs');
  for (const S of [SCHEMA, ALL]) for (const T of Object.keys(S).filter(t => t.endsWith('Hist'))) {
    const f = S[T].fields.change_reason;
    assert.ok(f, T + '.change_reason: объявлено');
    assert.equal(f.service, true, T + '.change_reason: служебное');
    assert.equal(f.db_type, 'STRING');
  }
  for (const T of Object.keys(MAP).filter(t => t.endsWith('Hist'))) assert.equal(MAP[T].change_reason && MAP[T].change_reason.rule, 'keep', T + '.change_reason');
});

test('вид продукта — набор: KnowDictEntry.kind и его версия — LIST (ADR-LORE-044)', () => {
  for (const T of ['KnowDictEntry', 'KnowDictEntryHist']) {
    const f = ALL[T].fields.kind;
    assert.ok(f, T + '.kind объявлено');
    assert.equal(f.db_type, 'LIST', T + '.kind — список');
    assert.equal(f.kind, 'list');
  }
});
