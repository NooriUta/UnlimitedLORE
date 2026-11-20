// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08 · Снятие легаси-полей при переносе 1.18.
//
// В 1.18 схема собирается заново из модели, поэтому снятие поля — правило карты переноса («не переносится»),
// а не шаг V. Ничего не теряется молча: непустое значение снятого поля уходит в остаток MigLeftover
// (kind legacy_field), а отчёт переноса объявляет убыль — report.legacy_drop: по каждому полю сколько записей
// источника несли значение и сколько строк ушло в остаток. Расхождение останавливает перенос до записи.
// Список полей и основание — rules/legacy-fields.json (владелица 20.11.2026: «mdl08 мы же утвердили уже, все поля»).
import LIST from './rules/legacy-fields.json' with { type: 'json' };

const DATE_RU = d => d.split('-').reverse().join('.');
/** Общая часть причины: задача, кто и когда утвердил — её же видно в карте и в строке остатка. */
export const LEGACY_WHY = `легаси, MDL-08, утверждено владелицей ${DATE_RU(LIST.approved)}: ${LIST.words}`;
/** «Тип.поле» → куда переехал смысл поля (первая пачка и дальнейшие — раздел more, у каждой своё слово владелицы). */
export const LEGACY = new Map([...Object.entries(LIST.fields), ...(LIST.more || []).flatMap(b => Object.entries(b.fields))]);
const WHY_OF = new Map([...Object.keys(LIST.fields).map(k => [k, { why: LEGACY_WHY, basis: LIST.basis }]),
  ...(LIST.more || []).flatMap(b => Object.keys(b.fields).map(k => [k, { why: `легаси, MDL-08, утверждено владелицей ${DATE_RU(b.approved)}: ${b.words}`, basis: b.basis }]))]);
export const LEGACY_KIND = 'legacy_field';

export const legacyGiven = v => !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));

/** Правило карты для поля из списка; null — поле не легаси. */
export function legacyRule(T, f) {
  const k = T + '.' + f;
  const where = LEGACY.get(k);
  if (where === undefined) return null;
  const b = WHY_OF.get(k);
  return { rule: 'drop', legacy: true, why: b.why + '; ' + where, basis: b.basis };
}

/** «Было»: считает по исходной записи (не по результату карты), сколько записей несут непустое значение. */
export function countLegacyBefore(T, rec, acc) {
  for (const k of LEGACY.keys()) {
    const [t, f] = k.split('.');
    if (t === T && legacyGiven(rec[f])) acc[k] = (acc[k] || 0) + 1;
  }
  return acc;
}

/** Строки остатка из корзины legacy исполнителя карты. */
export function legacyLeftovers(T, rid, res) {
  return Object.entries(res.legacy || {}).map(([f, value]) => ({ src_type: T, src_rid: rid, field: f, value, kind: LEGACY_KIND, why: legacyRule(T, f).why }));
}

/** Объявление убыли: каждое поле списка — было, ушло в остаток; ok — совпало у всех. */
export function legacyDrop(before, leftovers) {
  const fields = {};
  for (const k of [...LEGACY.keys()].sort()) fields[k] = { before: before[k] || 0, leftover: 0 };
  for (const x of leftovers) {
    if (x.kind !== LEGACY_KIND) continue;
    const k = x.src_type + '.' + x.field;
    (fields[k] ||= { before: before[k] || 0, leftover: 0 }).leftover++;
  }
  const mismatched = Object.keys(fields).filter(k => fields[k].before !== fields[k].leftover);
  const total = Object.values(fields).reduce((a, e) => ({ before: a.before + e.before, leftover: a.leftover + e.leftover }), { before: 0, leftover: 0 });
  return { basis: LEGACY_WHY, fields, total, mismatched, ok: mismatched.length === 0 };
}

/** Расхождение «было ≠ остаток» — стоп: значение снятого поля потерялось бы молча. */
export function assertLegacyDrop(rep) {
  if (rep.ok) return;
  throw new Error('объявление убыли MDL-08 не сошлось — перенос остановлен: ' + rep.mismatched.map(k => `${k}: было ${rep.fields[k].before}, в остатке ${rep.fields[k].leftover}`).join('; '));
}
