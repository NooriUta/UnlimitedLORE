// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 — доступ к базам переезда читается из файла вне репозитория.
// Сторожа: приёмник не может быть рабочей базой и не может совпасть с источником; значения секретов
// не попадают в текст ошибок и в сводку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, checkEnv, summary } from './env.mjs';

const ok = { MIG_DB_URL: 'http://h:2480', MIG_SRC_DB: 'migration_src', MIG_SRC_USER: 'u', MIG_SRC_PASSWORD: 'p-src-SECRET', MIG_DST_DB: 'migration_dst', MIG_DST_USER: 'w', MIG_DST_PASSWORD: 'p-dst-SECRET' };

test('разбор: пояснения и пустые строки пропускаются, знак = в значении сохраняется', () => {
  assert.deepEqual(parseEnv('# пояснение\n\nA=1\nB=x=y\r\nC=\n'), { A: '1', B: 'x=y', C: '' });
});

test('полный набор проходит', () => {
  assert.deepEqual(checkEnv(ok), []);
});

test('незаполненные ключи названы по именам', () => {
  const errs = checkEnv({ ...ok, MIG_SRC_PASSWORD: '', MIG_DST_DB: '' });
  assert.equal(errs.length, 2);
  assert.match(errs.join(' '), /MIG_SRC_PASSWORD/);
  assert.match(errs.join(' '), /MIG_DST_DB/);
});

test('приёмник — рабочая база: отказ', () => {
  for (const db of ['system_aida_lore', 'System_Aida_Lore']) assert.match(checkEnv({ ...ok, MIG_DST_DB: db }).join(' '), /рабоч/);
});

test('приёмник совпал с источником: отказ', () => {
  assert.match(checkEnv({ ...ok, MIG_DST_DB: 'migration_src' }).join(' '), /совпада/);
});

test('секреты не попадают ни в ошибки, ни в сводку', () => {
  const text = checkEnv({ ...ok, MIG_DST_DB: 'system_aida_lore' }).join(' ') + JSON.stringify(summary(ok));
  assert.doesNotMatch(text, /SECRET/);
  assert.equal(summary(ok).MIG_SRC_PASSWORD, 'задан');
});
