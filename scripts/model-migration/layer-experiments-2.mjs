#!/usr/bin/env node
// MIG-01 · Опыты на базе, вторая серия: объявление поверх «хороших» данных и снятие объявления.
// Только приёмник, типы MigLab*, после опытов удаляются.
import fs from 'node:fs';
import { connect } from './db.mjs';

const db = connect();
if (!/^migration_dst/.test(db.env.MIG_DST_DB)) throw new Error('опыты ставятся только в migration_dst*');
const log = [];
const short = v => { const s = JSON.stringify(v); return s.length > 300 ? s.slice(0, 300) + '…' : s; };
async function exp(id, what, fn) {
  let res, ok = true;
  try { res = await fn(); } catch (e) { ok = false; res = e.message.replace(/^база ответила \d+: /, '').slice(0, 300); }
  log.push({ id, what, ok, res });
  console.log(`${id} ${ok ? 'OK ' : 'ОТКАЗ'} · ${what}\n      → ${typeof res === 'string' ? res : short(res)}`);
}
const cmd = (c, p) => db.dstCommand(c, p);
const q = c => db.dstQuery(c);
const clean = r => r.map(x => { const o = { ...x }; delete o['@rid']; delete o['@type']; delete o['@cat']; return o; });
const LABS = ['MigLabD', 'MigLabE', 'MigLabF', 'MigLabG'];
for (const T of LABS) await cmd(`DROP TYPE ${T} IF EXISTS UNSAFE`);

await cmd('CREATE VERTEX TYPE MigLabD');
await cmd('INSERT INTO MigLabD CONTENT :c', { c: { k: 'd1', n: 1.5 } });
await cmd('INSERT INTO MigLabD CONTENT :c', { c: { k: 'd2', n: 2 } });
await cmd('INSERT INTO MigLabD CONTENT :c', { c: { k: 'd3' } });
await exp('Г1', 'объявить DOUBLE поверх данных, где лежат числа 1.5 и 2 и одна запись без поля', async () => { await cmd('CREATE PROPERTY MigLabD.n DOUBLE'); return clean(await q('SELECT k, n, n.type() AS t FROM MigLabD ORDER BY k')); });

await cmd('CREATE VERTEX TYPE MigLabE');
await cmd('INSERT INTO MigLabE CONTENT :c', { c: { k: 'e1', n: '1.5', d: '2026-06-04' } });
await exp('Г2', 'объявить DOUBLE поверх данных, где число лежит строкой "1.5" (приводимо)', async () => { await cmd('CREATE PROPERTY MigLabE.n DOUBLE'); return clean(await q('SELECT k, n, n.type() AS t FROM MigLabE')); });
await exp('Г3', 'объявить DATE поверх данных, где дата лежит строкой "2026-06-04" (приводимо)', async () => { await cmd('CREATE PROPERTY MigLabE.d DATE'); return clean(await q('SELECT k, d, d.type() AS t FROM MigLabE')); });
await exp('Г4', 'привести на месте и потом объявить: UPDATE … SET n = n.asDouble(), d = d.asDate()', async () => { await cmd("UPDATE MigLabE SET n = n.asDouble(), d = d.asDate('yyyy-MM-dd')"); const before = clean(await q('SELECT n.type() AS n_t, d.type() AS d_t FROM MigLabE')); let decl; try { await cmd('CREATE PROPERTY MigLabE.n IF NOT EXISTS DOUBLE'); await cmd('CREATE PROPERTY MigLabE.d IF NOT EXISTS DATE'); decl = 'объявлено'; } catch (e) { decl = 'ОТКАЗ: ' + e.message.slice(0, 160); } return { после_приведения: before, объявление: decl }; });

await cmd('CREATE VERTEX TYPE MigLabF');
await cmd('CREATE PROPERTY MigLabF.d DATE'); await cmd('CREATE PROPERTY MigLabF.n DOUBLE');
await cmd('INSERT INTO MigLabF CONTENT :c', { c: { k: 'f1', d: '2026-06-04', n: '1.5' } });
await exp('Г5', 'снять объявление у DATE и DOUBLE с данными: значения и их вид после DROP PROPERTY', async () => { await cmd('DROP PROPERTY MigLabF.d'); await cmd('DROP PROPERTY MigLabF.n'); return clean(await q('SELECT k, d, d.type() AS d_t, n, n.type() AS n_t FROM MigLabF')); });
await exp('Г6', 'после снятия объявления записать в то же поле строку: в одном поле два вида', async () => { await cmd('INSERT INTO MigLabF CONTENT :c', { c: { k: 'f2', d: '2026-06-05', n: 'много' } }); return clean(await q('SELECT k, d, d.type() AS d_t, n, n.type() AS n_t FROM MigLabF ORDER BY k')); });
await exp('Г7', 'сравнение и сортировка по полю, где дата лежит и датой, и строкой', async () => ({ больше_1_июня: (await q("SELECT count(*) AS c FROM MigLabF WHERE d >= date('2026-06-01', 'yyyy-MM-dd')"))[0].c, порядок: (await q('SELECT k FROM MigLabF ORDER BY d')).map(x => x.k) }));

await cmd('CREATE VERTEX TYPE MigLabG');
await cmd('CREATE PROPERTY MigLabG.s STRING');
await exp('Г8', 'обязательность: объявленное поле без значения и с null', async () => { await cmd('INSERT INTO MigLabG CONTENT :c', { c: { k: 'g1' } }); await cmd('INSERT INTO MigLabG CONTENT :c', { c: { k: 'g2', s: null } }); return clean(await q('SELECT k, s FROM MigLabG ORDER BY k')); });
await exp('Г9', 'размер: одна и та же запись с объявлением и без — заметной разницы в ответе нет', async () => (await q('SELECT count(*) AS n FROM MigLabG'))[0]);

for (const T of LABS) await cmd(`DROP TYPE ${T} IF EXISTS UNSAFE`);
console.log('типы опытов удалены:', (await q('SELECT name FROM schema:types')).filter(x => x.name.startsWith('MigLab')).length === 0);
const outArg = process.argv.indexOf('--out');
if (outArg > 0) fs.writeFileSync(process.argv[outArg + 1], JSON.stringify(log, null, 1));
