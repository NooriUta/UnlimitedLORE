// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Дубли уникального ключа при переносе (D-2026-MIG-SETTING-LIST-VALUE).
// Слово владелицы 18.11.2026: «можно отрезать организацию логин и все будет нормально но репозиторий один основной
// остальное зеркала». Правило: строки с одним ключом, значения которых отличаются только организацией
// («AIDA/UnlimitedLORE», «NooriUta/UnlimitedLORE»), — одна строка; значение — slug проекта LORE, если он среди них
// (опросчик QG по нему берёт основной репозиторий проекта), иначе — без организации; остаётся активная
// (иначе последняя по адресу источника), прочие — в остаток переноса с причиной. Значения разные по сути — не сливаются:
// все строки остаются, конфликт — в отчёт (решает человек).

const keyOf = (out, fields) => fields.map(f => out[f] ?? '').join('|');
const noOrg = v => String(v ?? '').replace(/^[^/\s]+\//, '');

/** rows — [{rid, res:{out}}]; keyFields — поля уникального ключа; valueField — поле значения; knownValues — значения, которые знает система (slug проектов LORE). */
export function mergeKeyDups(rows, keyFields, valueField, knownValues = new Set()) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(r.res.out, keyFields);
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const drop = new Set(), leftovers = [], conflicts = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const vals = list.map(r => r.res.out[valueField]);
    const bare = new Set(vals.map(noOrg));
    if (bare.size !== 1) { conflicts.push({ key, rids: list.map(r => r.rid), values: vals }); continue; }
    const sorted = [...list].sort((a, b) => String(a.rid).localeCompare(String(b.rid), undefined, { numeric: true }));
    const keep = sorted.find(r => r.res.out.is_active === true) || sorted[sorted.length - 1];
    // значение — то, что знает система (slug проекта LORE: опросчик QG берёт по нему основной репозиторий);
    // иначе — общее значение без организации
    keep.res.out[valueField] = vals.find(v => knownValues.has(v)) ?? [...bare][0];
    for (const r of list) {
      if (r === keep) continue;
      drop.add(r);
      leftovers.push({ src_rid: r.rid, field: valueField, value: r.res.out[valueField], kind: 'merged_duplicate',
        why: `дубль ключа ${key}: значения отличаются только организацией — оставлена одна строка (${keep.rid}) со значением «${keep.res.out[valueField]}»` });
    }
  }
  return { keep: rows.filter(r => !drop.has(r)), leftovers, conflicts };
}
