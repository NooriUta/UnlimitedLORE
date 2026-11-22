// Перенос со СТАРОЙ базы: типа карты в источнике может не быть вовсе.
// Найдено 22.11.2026 на прогоне установщика 1.18.2 (ryzenai, бэкап прода 01.11.2026): шаг чтения выбирал все типы
// карты подряд, и ArcadeDB отвечал 500 «Type with name 'KnowCanvas' was not found» — перенос падал на первом же
// типе, заведённом после снимка (15 типов карты из 69 в той базе отсутствуют). Нет типа в источнике = нет записей.
import test from 'node:test';
import assert from 'node:assert/strict';
import { transfer } from './transfer.mjs';

/** Источник без типов, появившихся позже: SELECT из такого типа отвечает так же, как ArcadeDB. */
function oldSource(present) {
  const seen = [];
  const src = async command => {
    seen.push(command);
    if (/FROM schema:types/.test(command)) return [...present].map(name => ({ name, type: 'vertex', records: 0, properties: [], indexes: [] }));
    const m = /FROM (\w+)/.exec(command);
    if (m && !present.has(m[1])) throw new Error(`база ответила 500: {"error":"Internal error","exception":"com.arcadedb.exception.SchemaException","detail":"Type with name '${m[1]}' was not found"}`);
    return [];
  };
  return {
    seen,
    env: { MIG_SRC_DB: 'migration_src_test', MIG_DST_DB: 'migration_dst_test', MIG_SRC_USER: 'root', MIG_DST_USER: 'root' },
    src,
    async *scan(T) { for (const r of await src(`SELECT FROM ${T} WHERE @rid > #-1:-1 ORDER BY @rid LIMIT 2000`)) yield r; },
    dstQuery: async () => [],
    dstCommand: async () => [{ '@rid': '#1:1' }],
  };
}

test('тип карты, которого нет в старом источнике, не роняет перенос: читается как «записей нет»', async () => {
  // В источнике — типы, которые перенос спрашивает поимённо; всё остальное из карты заведено позже снимка.
  const db = oldSource(new Set(['KnowDictEntry', 'KnowTask', 'KnowGitProject']));
  let err = null;
  try { await transfer(db, { decisions: [] }, { log: () => {} }); } catch (e) { err = e; }
  assert.ok(err, 'пустой приёмник без схемы всё равно остановит перенос дальше — важно, ГДЕ он остановится');
  assert.doesNotMatch(err.message, /was not found/,
    'перенос упал на отсутствующем типе источника вместо того, чтобы считать его пустым: ' + err.message);
  // Схему источника перенос обязан спросить до выборок по типам — иначе он снова пойдёт в несуществующий тип.
  const schemaAt = db.seen.findIndex(q => /FROM schema:types/.test(q));
  const scanAt = db.seen.findIndex(q => /FROM Know\w+ WHERE @rid/.test(q));
  assert.ok(schemaAt >= 0, 'перенос не спросил схему источника');
  assert.ok(scanAt === -1 || schemaAt < scanAt, 'выборка по типу идёт раньше, чем узнали состав источника');
});
