// Опыт на пустой базе-приёмнике: как ArcadeDB принимает даты и JSON-содержимое. Тип создаётся и удаляется.
import { connect } from 'file:///C:/AIDA/UnlimitedLORE/.claude/worktrees/mig/scripts/model-migration/db.mjs';
const db = connect();
const run = async (label, fn) => { try { console.log(label, '→', JSON.stringify(await fn()).slice(0, 400)); } catch (e) { console.log(label, '→ ОШИБКА', e.message.slice(0, 300)); } };
await run('drop', () => db.dstCommand('DROP TYPE MigProbe IF EXISTS UNSAFE'));
await run('type', () => db.dstCommand('CREATE VERTEX TYPE MigProbe'));
await run('props', async () => { for (const p of ['d DATE', 'dt DATETIME', 's STRING', 'n DOUBLE', 'b BOOLEAN']) await db.dstCommand('CREATE PROPERTY MigProbe.' + p); return 'ok'; });
await run('formats', () => db.dstQuery("SELECT FROM schema:database"));
await run('insert iso', () => db.dstCommand('INSERT INTO MigProbe CONTENT ' + JSON.stringify({ d: '2026-06-04', dt: '2026-06-04T07:11:12.000Z', s: 'строка с "кавычками"\nи переносом \\ слэш', n: 1.5, b: true })));
await run('insert params', () => db.dstCommand('INSERT INTO MigProbe SET d = :d, dt = :dt, s = :s', { d: '2026-06-05', dt: '2026-06-05 07:11:12', s: 'p' }));
await run('insert content param', () => db.dstCommand('INSERT INTO MigProbe CONTENT :c', { c: { d: '2026-06-06', s: 'через параметр' } }));
await run('read', () => db.dstQuery('SELECT d, dt, s, n, b, d.format("yyyy-MM-dd") AS d_txt, dt.format("yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'", "UTC") AS dt_txt FROM MigProbe'));
await run('where date', () => db.dstQuery("SELECT count(*) AS n FROM MigProbe WHERE d >= date('2026-06-05', 'yyyy-MM-dd')"));
await run('batch script', () => db.dstCommand('INSERT INTO MigProbe SET s = "a"; INSERT INTO MigProbe SET s = "b"; SELECT count(*) AS n FROM MigProbe;', undefined, 'sqlscript'));
await run('drop', () => db.dstCommand('DROP TYPE MigProbe UNSAFE'));
