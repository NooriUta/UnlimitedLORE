#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Опыты на базе: что происходит со значением, когда поле меняет слой —
// «было объявлено в схеме → стало опциональным» и «было необъявленным → стало объявленным».
// Работает ТОЛЬКО в приёмнике, в своих типах MigLab*; после опытов типы удаляются.
// Каждый опыт печатает: что сделали → что ответила база. Выводов скрипт не делает — они в методике.
import fs from 'node:fs';
import { connect } from './db.mjs';

const db = connect();
if (!/^migration_dst/.test(db.env.MIG_DST_DB)) throw new Error('опыты ставятся только в migration_dst*');
const log = [];
const short = v => { const s = JSON.stringify(v); return s.length > 260 ? s.slice(0, 260) + '…' : s; };
async function exp(id, what, fn) {
  let res, ok = true;
  try { res = await fn(); } catch (e) { ok = false; res = e.message.replace(/^база ответила \d+: /, '').slice(0, 260); }
  log.push({ id, what, ok, res });
  console.log(`${id} ${ok ? 'OK ' : 'ОТКАЗ'} · ${what}\n      → ${typeof res === 'string' ? res : short(res)}`);
  return ok ? res : null;
}
const cmd = (c, p) => db.dstCommand(c, p);
const q = c => db.dstQuery(c);
const clean = r => (Array.isArray(r) ? r.map(x => { const o = { ...x }; delete o['@rid']; delete o['@type']; delete o['@cat']; return o; }) : r);
for (const T of ['MigLabA', 'MigLabB', 'MigLabC']) await cmd(`DROP TYPE ${T} IF EXISTS UNSAFE`);

// ── А. Было объявлено → стало опциональным: тип без объявления свойства ─────────────────────────────
await cmd('CREATE VERTEX TYPE MigLabA');
await exp('А1', 'запись в необъявленное поле: число, строка, признак, список, вложенный объект', async () => clean(await cmd('INSERT INTO MigLabA CONTENT :c', { c: { k: 'a1', n: 1.5, s: 'текст', b: true, l: ['#101', '#102'], m: { x: 1 } } })));
await exp('А2', 'дата в необъявленное поле строкой ГГГГ-ММ-ДД — чем она становится', async () => { await cmd('INSERT INTO MigLabA CONTENT :c', { c: { k: 'a2', d: '2026-06-04', dt: '2026-06-04T07:11:12.000Z' } }); return clean(await q("SELECT d, dt, d.type() AS d_type, dt.type() AS dt_type FROM MigLabA WHERE k = 'a2'")); });
await exp('А3', 'сравнение необъявленной даты-строки с датой: WHERE d >= date(…)', async () => q("SELECT count(*) AS n FROM MigLabA WHERE d >= date('2026-06-01', 'yyyy-MM-dd')"));
await exp('А4', 'сравнение необъявленной даты-строки со строкой: WHERE d >= \'2026-06-01\'', async () => q("SELECT count(*) AS n FROM MigLabA WHERE d >= '2026-06-01'"));
await exp('А5', 'в одно необъявленное поле — значения разных видов (строка, потом список)', async () => { await cmd('INSERT INTO MigLabA CONTENT :c', { c: { k: 'a5a', mix: '#101, #102' } }); await cmd('INSERT INTO MigLabA CONTENT :c', { c: { k: 'a5b', mix: ['#103'] } }); return clean(await q("SELECT k, mix, mix.type() AS t FROM MigLabA WHERE mix IS NOT NULL ORDER BY k")); });
await exp('А6', 'индекс по необъявленному полю', async () => cmd('CREATE INDEX ON MigLabA (k) NOTUNIQUE'));
await exp('А7', 'отсутствующее необъявленное поле при чтении: ключа нет или null', async () => clean(await q("SELECT k, n FROM MigLabA WHERE k = 'a2'")));

// ── Б. Было необъявленным → стало объявленным: свойство с типом ─────────────────────────────────────
await cmd('CREATE VERTEX TYPE MigLabB');
for (const p of ['k STRING', 'n DOUBLE', 'i INTEGER', 'b BOOLEAN', 'd DATE', 'dt DATETIME', 's STRING', 'l LIST']) await cmd('CREATE PROPERTY MigLabB.' + p);
await exp('Б1', 'число строкой в объявленное DOUBLE: "1.5"', async () => clean(await cmd('INSERT INTO MigLabB CONTENT :c', { c: { k: 'b1', n: '1.5' } })));
await exp('Б2', 'не-число в объявленное DOUBLE: "много"', async () => clean(await cmd('INSERT INTO MigLabB CONTENT :c', { c: { k: 'b2', n: 'много' } })));
await exp('Б3', 'дробное в объявленное INTEGER: 2.7', async () => clean(await cmd('INSERT INTO MigLabB CONTENT :c', { c: { k: 'b3', i: 2.7 } })));
await exp('Б4', 'не-дата в объявленное DATE: "июнь"', async () => clean(await cmd('INSERT INTO MigLabB CONTENT :c', { c: { k: 'b4', d: 'июнь' } })));
await exp('Б5', 'дата другого формата в объявленное DATE: "04.06.2026"', async () => clean(await cmd('INSERT INTO MigLabB CONTENT :c', { c: { k: 'b5', d: '04.06.2026' } })));
await exp('Б6', 'момент с поясом в объявленное DATETIME: "2026-06-04T10:11:12+03:00"', async () => clean(await cmd('INSERT INTO MigLabB CONTENT :c', { c: { k: 'b6', dt: '2026-06-04T10:11:12+03:00' } })));
await exp('Б7', 'строка в объявленное BOOLEAN: "да" и "true"', async () => { const a = await cmd('INSERT INTO MigLabB CONTENT :c', { c: { k: 'b7a', b: 'true' } }); let b; try { b = await cmd('INSERT INTO MigLabB CONTENT :c', { c: { k: 'b7b', b: 'да' } }); } catch (e) { b = 'ОТКАЗ: ' + e.message.slice(0, 120); } return [clean(a), typeof b === 'string' ? b : clean(b)]; });
await exp('Б8', 'список в объявленное STRING и строка в объявленный LIST', async () => { const out = []; for (const c of [{ k: 'b8a', s: ['#101', '#102'] }, { k: 'b8b', l: '#101, #102' }]) { try { out.push(clean(await cmd('INSERT INTO MigLabB CONTENT :c', { c }))); } catch (e) { out.push('ОТКАЗ: ' + e.message.slice(0, 140)); } } return out; });
await exp('Б9', 'поле, которого нет в объявлениях, в типе с объявлениями', async () => clean(await cmd('INSERT INTO MigLabB CONTENT :c', { c: { k: 'b9', extra: 'не объявлено' } })));
await exp('Б10', 'объявленная дата: сравнение с датой работает', async () => { await cmd('INSERT INTO MigLabB CONTENT :c', { c: { k: 'b10', d: '2026-06-04' } }); return q("SELECT count(*) AS n FROM MigLabB WHERE d >= date('2026-06-01', 'yyyy-MM-dd')"); });

// ── В. Смена слоя на месте, при уже лежащих данных ──────────────────────────────────────────────────
await cmd('CREATE VERTEX TYPE MigLabC');
await cmd('INSERT INTO MigLabC CONTENT :c', { c: { k: 'c1', n: '1.5', d: '2026-06-04' } });
await cmd('INSERT INTO MigLabC CONTENT :c', { c: { k: 'c2', n: 'много', d: 'июнь' } });
await exp('В1', 'объявить DOUBLE поверх данных, где лежат "1.5" и "много"', async () => cmd('CREATE PROPERTY MigLabC.n DOUBLE'));
await exp('В2', 'что читается после объявления: старые значения приведены или остались строками', async () => clean(await q('SELECT k, n, n.type() AS t FROM MigLabC ORDER BY k')));
await exp('В3', 'объявить DATE поверх данных, где лежат "2026-06-04" и "июнь"', async () => cmd('CREATE PROPERTY MigLabC.d DATE'));
await exp('В4', 'что читается после объявления даты', async () => clean(await q('SELECT k, d, d.type() AS t FROM MigLabC ORDER BY k')));
await exp('В5', 'обновление записи после объявления: UPDATE … SET k = k на записи с "много"', async () => clean(await cmd("UPDATE MigLabC SET touched = true WHERE k = 'c2'")));
await exp('В6', 'снять объявление: DROP PROPERTY — данные остаются?', async () => { await cmd('DROP PROPERTY MigLabC.n'); return clean(await q('SELECT k, n, n.type() AS t FROM MigLabC ORDER BY k')); });
await exp('В7', 'снять объявление у поля с индексом', async () => { await cmd('CREATE PROPERTY MigLabC.k STRING'); await cmd('CREATE INDEX ON MigLabC (k) NOTUNIQUE'); try { return await cmd('DROP PROPERTY MigLabC.k'); } catch (e) { return 'ОТКАЗ: ' + e.message.slice(0, 200); } });

for (const T of ['MigLabA', 'MigLabB', 'MigLabC']) await cmd(`DROP TYPE ${T} IF EXISTS UNSAFE`);
const left = (await q('SELECT name FROM schema:types')).map(x => x.name).filter(n => n.startsWith('MigLab'));
console.log('типы опытов удалены:', left.length === 0);
const outArg = process.argv.indexOf('--out');
if (outArg > 0) fs.writeFileSync(process.argv[outArg + 1], JSON.stringify(log, null, 1));
