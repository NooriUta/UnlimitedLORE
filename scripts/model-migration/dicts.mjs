// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Справочники в новой базе.
// Правило переноса (владелица 16.11.2026): в записи — только код; подпись — в справочнике, по строке на пару
// «значение — язык»; третий и следующие языки добавляются данными, без смены схемы. Источник — правила
// (rules/status-unification.json) и коды, добавленные решениями человека (add_code).
//   MigDictEntry  — значение: dict_type, code, kind (status | other), sort_order, icon, added_by
//   MigDictLabel  — подпись: dict_type, code, lang, label
// Имена с Mig*: это предложение для новой схемы; итоговые имена типов — решение владелицы вместе с моделью.
import { statusDictOf } from './status-unify.mjs';

export const ENTRY = 'MigDictEntry', LABEL = 'MigDictLabel';

/** Строки справочников: значения и подписи. Детерминированно — порядок правил, затем добавленные решениями. */
export function dictRows(rules, decisionsDoc) {
  const entries = [], labels = [];
  const push = (dict, kind, c, i, addedBy) => {
    entries.push({ dict_type: dict, code: c.code, kind, sort_order: i, icon: c.icon ?? null, added_by: addedBy ?? null });
    for (const lang of rules.languages) labels.push({ dict_type: dict, code: c.code, lang, label: c.labels[lang] });
  };
  for (const [dict, d] of Object.entries(rules.dictionaries)) d.codes.forEach((c, i) => push(dict, d.kind, c, (i + 1) * 10));
  const seen = new Set(entries.map(e => `${e.dict_type}|${e.code}`));
  for (const dec of (decisionsDoc && decisionsDoc.decisions) || []) {
    if (dec.action !== 'add_code') continue;
    const dict = statusDictOf(rules, dec.scope);
    if (!dict) continue;
    const k = `${dict}|${dec.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const n = entries.filter(e => e.dict_type === dict).length;
    push(dict, rules.dictionaries[dict].kind, { code: dec.to, labels: dec.labels }, (n + 1) * 10, dec.id);
  }
  return { entries, labels };
}

/** Записать справочники в новую базу (типы создаются заново). Возвращает число значений и подписей. */
export async function writeDictionaries(db, rules, decisionsDoc, { log = console.log } = {}) {
  const { entries, labels } = dictRows(rules, decisionsDoc);
  const existing = (await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name);
  for (const t of [LABEL, ENTRY]) if (existing.includes(t)) await db.dstCommand(`DROP TYPE ${t} UNSAFE`);
  await db.dstCommand(`CREATE DOCUMENT TYPE ${ENTRY}`);
  for (const [f, ty] of [['dict_type', 'STRING'], ['code', 'STRING'], ['kind', 'STRING'], ['sort_order', 'INTEGER'], ['icon', 'STRING'], ['added_by', 'STRING']])
    await db.dstCommand(`CREATE PROPERTY ${ENTRY}.${f} ${ty}`);
  await db.dstCommand(`CREATE INDEX ON ${ENTRY} (dict_type, code) UNIQUE`);
  await db.dstCommand(`CREATE DOCUMENT TYPE ${LABEL}`);
  for (const f of ['dict_type', 'code', 'lang', 'label']) await db.dstCommand(`CREATE PROPERTY ${LABEL}.${f} STRING`);
  await db.dstCommand(`CREATE INDEX ON ${LABEL} (dict_type, code, lang) UNIQUE`);
  for (const e of entries) await db.dstCommand(`INSERT INTO ${ENTRY} CONTENT :c`, { c: e });
  for (const l of labels) await db.dstCommand(`INSERT INTO ${LABEL} CONTENT :c`, { c: l });
  const got = (await db.dstQuery(`SELECT count(*) AS n FROM ${ENTRY}`))[0].n, gotL = (await db.dstQuery(`SELECT count(*) AS n FROM ${LABEL}`))[0].n;
  const ok = got === entries.length && gotL === labels.length;
  log(`справочники: значений ${got} из ${entries.length}, подписей ${gotL} из ${labels.length} — ${ok ? 'сошлось' : 'НЕ сошлось'}`);
  return { ok, entries: got, labels: gotL };
}
