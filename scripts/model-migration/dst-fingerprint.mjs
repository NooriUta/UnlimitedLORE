#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Отпечаток содержимого новой базы — сверка двух переносов.
// Слова владелицы 16.11.2026: «принимаем на этой машине и на razenai должно сойтись с одинаковыми настройками».
// Читает только приёмник: все записи и связи его типов; печатает по каждому типу число и отпечаток и общий
// отпечаток. Две новые базы, собранные с одинаковыми настройками из одного источника, обязаны совпасть.
// Запуск: lore-migrate dst-fingerprint --env <файл доступа> [--out отпечаток.json]
import fs from 'node:fs';
import { connect } from './db.mjs';
import { contentFingerprint } from './fingerprint.mjs';

/**
 * Изменчивые поля — не содержимое: время сборки отметки «схема собрана из модели» разное у каждого прогона.
 * 18.11.2026, all4/all4b: две базы совпали по всем типам, кроме LoreModelSchema — только из-за built_at.
 */
const VOLATILE = { LoreModelSchema: ['built_at'] };
export function stripVolatile(T, row) {
  const drop = VOLATILE[T];
  if (!drop) return row;
  const out = { ...row };
  for (const f of drop) delete out[f];
  return out;
}

/** Отпечаток содержимого новой базы. */
export async function dstFingerprint(db) {
  const types = (await db.dstQuery("SELECT name, type FROM schema:types")).filter(t => t.type === 'vertex' || t.type === 'edge' || t.type === 'document');
  const vertices = {}, edges = {};
  for (const t of types.sort((a, b) => a.name.localeCompare(b.name))) {
    const all = [];
    let last = '#-1:-1';
    for (;;) {
      const rows = await db.dstQuery(`SELECT FROM ${t.name} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`);
      all.push(...rows.filter(r => r['@type'] === t.name).map(r => stripVolatile(t.name, r))); // без записей подтипов: они посчитаны у своего типа
      if (rows.length < 5000) break;
      last = rows[rows.length - 1]['@rid'];
    }
    (t.type === 'edge' ? edges : vertices)[t.name] = all; // документы (справочники) — по содержимому, как записи
  }
  const fp = contentFingerprint({ vertices, edges });
  return fp;
}

if (process.argv[1] === 'dst-fingerprint') {
const db = connect();
const fp = await dstFingerprint(db);
const outArg = process.argv.indexOf('--out');
if (outArg > 0) fs.writeFileSync(process.argv[outArg + 1], JSON.stringify(fp, null, 1));
console.log(`новая база ${db.env.MIG_DST_DB}: типов ${Object.keys(fp.types).length}`);
for (const [T, x] of Object.entries(fp.types)) console.log(`  ${T}: ${x.n} · ${x.fp}`);
console.log(`отпечаток содержимого: ${fp.total}`);
}
