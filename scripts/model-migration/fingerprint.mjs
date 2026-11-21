// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Отпечаток итога шага для приёмки на двух машинах.
// Слова владелицы 16.11.2026: «принимаем на этой машине и на razenai должно сойтись с одинаковыми настройками».
// Итог приводится к каноническому виду (ключи по алфавиту, без undefined) и сворачивается в SHA-256;
// первые 16 знаков печатаются рядом с итогом. Одинаковые настройки и источник → одинаковый отпечаток.
import crypto from 'node:crypto';

export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : canonical(x))).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

export const fingerprint = v => crypto.createHash('sha256').update(canonical(v)).digest('hex').slice(0, 16);

const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const own = r => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('@')));

/**
 * Отпечаток содержимого базы для сверки двух переносов: записи — по своим полям (без @rid и прочих
 * служебных @), связи — по содержимому концов и своим полям. Адреса записей у двух баз разные, порядок
 * выборки тоже; отпечаток от них не зависит. Вход: { vertices: {тип: [запись]}, edges: {тип: [связь]} }.
 */
export function contentFingerprint({ vertices = {}, edges = {} }) {
  const byRid = new Map(), types = {};
  for (const [T, rows] of Object.entries(vertices)) {
    const hs = rows.map(r => { const h = hash(canonical(own(r))); byRid.set(r['@rid'], h); return h; }).sort();
    types[T] = { n: hs.length, fp: hash(hs.join(',')) };
  }
  for (const [T, rows] of Object.entries(edges)) {
    const hs = rows.map(e => hash(canonical({ out: byRid.get(e['@out']) ?? '?', in: byRid.get(e['@in']) ?? '?', p: own(e) }))).sort();
    types[T] = { n: hs.length, fp: hash(hs.join(',')) };
  }
  return { types, total: hash(canonical(types)) };
}
