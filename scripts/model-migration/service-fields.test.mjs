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
    const f = SCHEMA[T].fields.changed_by_session;
    assert.ok(f, T + ': поле объявлено');
    assert.equal(f.service, true, T + ': служебное');
    assert.equal(f.db_type, 'STRING');
  }
});
