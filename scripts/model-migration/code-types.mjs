// SPRINT_LORE_MODEL_DOCS_TIDY/MD-02 8а · Какие типы и связи трогает код сервера LORE — по тексту SQL в исходниках.
// Владелица 19.11.2026: «функции оставить» — каждый тип, который трогает код, есть в схеме 1.18, даже пустой.
// Отсюда же генератор карты решает судьбу пустого типа (propose-map-all.mjs), а сторож сверяет модель с кодом.
//
// Узнаётся литеральное имя типа после INSERT INTO / UPDATE / DELETE FROM / CREATE VERTEX / CREATE EDGE / SELECT … FROM
// внутри строкового литерала Java; константа вида `static final String TYPE = "X"` или `EDGE = "X"` подставляется,
// если в том же файле строка собрана через «+ TYPE +». Связь, которую пишет помощник createEdgeIfVerticesExist("X", …),
// тоже считается. DDL (CREATE … TYPE, CREATE PROPERTY, CREATE INDEX) — не «трогает», а заводит: его читает declaredDdl.
// Только пакет lore: bench/MartSlices читает другую базу (витрину эксперимента), не LORE.
import fs from 'node:fs';
import path from 'node:path';

const VERB = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|DELETE\s+VERTEX|CREATE\s+VERTEX|CREATE\s+EDGE|FROM)\s+`?([A-Z][A-Za-z0-9_]*)`?/g;
const NOT_TYPE = new Set(['TYPE', 'SET', 'IF', 'CONTENT', 'MERGE', 'SELECT', 'WHERE', 'FROM']);
const HELPER = /createEdgeIfVerticesExist\(\s*"([A-Z][A-Za-z0-9_]*)"/g;

/** Константы-имена типа во всех файлах: «Класс.ИМЯ» и (в своём файле) «ИМЯ» → значение. */
function constantsOf(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.java'))) {
    const cls = f.slice(0, -5);
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/static\s+final\s+String\s+([A-Z_]+)\s*=\s*"([A-Za-z][A-Za-z0-9_]*)"\s*;/g)) (out[cls] ||= {})[m[1]] = m[2];
  }
  return out;
}

/** Текст файла: склеенные «"…" + "…"», константы-имена подставлены (своя — ИМЯ, чужая — Класс.ИМЯ), комментарии убраны. */
export function sqlText(src, own = {}, all = {}) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const subs = [...Object.entries(own).map(([k, v]) => [k, v]), ...Object.entries(all).flatMap(([c, ks]) => Object.entries(ks).map(([k, v]) => [c + '\\.' + k, v]))];
  for (const [k, v] of subs) s = s.replace(new RegExp('"\\s*\\+\\s*' + k + '\\s*\\+\\s*"', 'g'), v).replace(new RegExp('"\\s*\\+\\s*' + k + '\\s*([,)])', 'g'), v + '"$1');
  return s.replace(/"\s*\+\s*"/g, '');
}
const read = (dir, f, consts) => sqlText(fs.readFileSync(path.join(dir, f), 'utf8'), consts[f.slice(0, -5)] || {}, consts);

/** Строковые литералы Java (после склейки). */
const literals = s => [...s.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map(m => m[1]);

/**
 * Типы и связи, которые трогает код: Map имя → Set «Файл.java». names — имена типов источника: литерал, равный
 * такому имени целиком (ключ реестра вида HIST_PARENT, по которому код строит «SELECT … FROM » + тип), тоже считается.
 */
export function codeTypes(dir, names = new Set()) {
  const out = new Map();
  const consts = constantsOf(dir);
  const add = (t, f) => { if (!NOT_TYPE.has(t)) (out.get(t) || out.set(t, new Set()).get(t)).add(f); };
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.java')).sort()) {
    const s = read(dir, f, consts);
    for (const lit of literals(s)) {
      if (/^\s*CREATE\s+(VERTEX|EDGE|DOCUMENT)\s+TYPE\b|^\s*CREATE\s+(PROPERTY|INDEX)\b|^\s*DROP\s/i.test(lit)) continue;
      for (const m of lit.matchAll(VERB)) add(m[2], f);
      if (names.has(lit)) add(lit, f);
    }
    for (const m of s.matchAll(HELPER)) add(m[1], f);
  }
  return out;
}

/** Объявления старой схемы в коде (DDL шагов V): тип → { kind: VERTEX|EDGE|DOCUMENT, props: {поле: тип}, indexes: [{fields, kind}] }. */
export function declaredDdl(dir) {
  const out = {};
  const consts = constantsOf(dir);
  const T = n => (out[n] ||= { props: {}, indexes: [] });
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.java')).sort()) {
    const s = read(dir, f, consts);
    for (const lit of literals(s)) {
      let m;
      if ((m = /^\s*CREATE\s+(VERTEX|EDGE|DOCUMENT)\s+TYPE\s+`?([A-Za-z0-9_]+)`?/i.exec(lit))) T(m[2]).kind ||= m[1].toUpperCase();
      else if ((m = /^\s*CREATE\s+PROPERTY\s+([A-Za-z0-9_]+)\.`?([A-Za-z0-9_]+)`?\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Z]+)/i.exec(lit))) T(m[1]).props[m[2]] ||= m[3].toUpperCase();
      else if ((m = /^\s*CREATE\s+INDEX\s+(?:`?\w+`?\s+)?(?:IF\s+NOT\s+EXISTS\s+)?ON\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(UNIQUE|NOTUNIQUE|FULL_TEXT)/i.exec(lit))) {
        const ix = { fields: m[2].split(',').map(x => x.trim().replace(/`/g, '')), kind: m[3].toUpperCase() };
        if (!T(m[1]).indexes.some(x => JSON.stringify(x) === JSON.stringify(ix))) T(m[1]).indexes.push(ix);
      }
    }
  }
  return out;
}

/** Поля, которые код пишет в тип: «INSERT INTO T SET a = …» и «UPDATE T SET a = … [UPSERT] WHERE …» → {T: [поля]}. */
export function codeWrittenFields(dir, types) {
  const out = {};
  const consts = constantsOf(dir);
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.java')).sort()) {
    const s = read(dir, f, consts);
    for (const lit of literals(s)) for (const T of types) {
      const m = new RegExp('(?:INSERT\\s+INTO|UPDATE)\\s+' + T + '\\s+SET\\s+(.*?)(?:\\s+UPSERT\\b|\\s+WHERE\\b|$)', 'is').exec(lit);
      if (!m) continue;
      const set = (out[T] ||= new Set());
      for (const a of m[1].matchAll(/(?:^|,)\s*`?([a-z_][a-z0-9_]*)`?\s*=/g)) set.add(a[1]);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([T, s]) => [T, [...s].sort()]));
}

export const LORE_JAVA = new URL('../../backend/src/main/java/studio/seer/heimdall/lore/', import.meta.url);
