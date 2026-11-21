// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Сбор диалога статусов по источнику — общий для команды statuses и
// интерфейса установщика. Источник только читается; «не смогли прочитать» — не «чисто».
import { buildDialog } from './status-unify.mjs';
import { fingerprint } from './fingerprint.mjs';
import { needsRecords, recordsOf } from './status-records.mjs';

/**
 * recordsCache — Map «тип|поле|значение» → записи (MIG-01, 20.11.2026: у значения видны записи, в которых оно
 * встречается). Записи от решений не зависят: интерфейс держит кэш между решениями и сбрасывает на «Перепроверить».
 */
export async function collectStatusDialog(db, rules, decisions, { recordsCache = new Map() } = {}) {
  const counts = [];
  for (const s of rules.sources) {
    let rows;
    try { rows = await db.src(`SELECT ${s.field} AS v, count(*) AS n FROM ${s.type} GROUP BY ${s.field}`); }
    catch (e) { counts.push({ type: s.type, field: s.field, value: null, n: 0, error: e.message.slice(0, 120) }); continue; }
    for (const r of rows) counts.push({ type: s.type, field: s.field, value: r.v ?? null, n: r.n });
  }
  const failed = counts.filter(c => c.error);
  const dialog = buildDialog(counts.filter(c => !c.error), rules, decisions);
  dialog.source = db.env.MIG_SRC_DB;
  dialog.unread = failed.map(c => ({ type: c.type, field: c.field, error: c.error }));
  if (failed.length) dialog.ready = false;
  // отпечаток — по итогу сведения, до записей: записи — справка человеку, итог переноса они не меняют
  dialog.fingerprint = fingerprint({ rows: dialog.rows, summary: dialog.summary, added: dialog.added });
  const todo = dialog.rows.filter(needsRecords);
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < todo.length) {
      const r = todo[i++], k = `${r.type}|${r.field}|${r.value ?? ''}`;
      if (!recordsCache.has(k) || recordsCache.get(k).error) recordsCache.set(k, await recordsOf(db, r));
      r.records = recordsCache.get(k);
    }
  }));
  return dialog;
}
