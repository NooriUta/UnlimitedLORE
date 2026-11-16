// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Исполнитель карты переноса.
//
// Чистая функция: запись старой базы + карта её типа → запись новой базы. Базы не касается, поэтому
// проверяется тестами без снимка прода и даёт один и тот же ответ на один и тот же вход.
//
// Правило: ничего не теряется молча. У результата шесть корзин:
//   out           — поля записи в новой базе;
//   toVersion     — значения, которые живут в текущей версии, а не на записи (кладёт вызывающий код,
//                   если в текущей версии пусто);
//   dropped       — поля, которые по карте не переносятся (имена);
//   held          — поля без решения владелицы и преобразования-предложения: исходное значение удержано;
//   rejects       — значения, которые не удалось привести к виду: поле, значение, причина;
//   titleFallback — не-статус из статуса версии фазы: вызывающий код кладёт его в название, если оно пусто.
// Поле записи, которого нет в карте, — ошибка: карта обязана знать каждое поле.

const ENGINE = /^@/; // @rid, @type, @cat, @in, @out — служебные поля движка, новая база выдаёт свои
const given = v => v !== undefined && v !== null && v !== '';

const valid = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Дата в виде ГГГГ-ММ-ДД из трёх форматов прода; иначе null — формат не угадывается. */
import { resolveRejects } from './decisions.mjs';

export function toDate(v) {
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/))) return valid(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
  if ((m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/))) return valid(+m[3], +m[2], +m[1]) ? iso(+m[3], +m[2], +m[1]) : null;
  return null;
}

/** Момент в ISO-8601, UTC. Дата без времени — полночь UTC; время без пояса считается UTC. */
export function toDateTime(v) {
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return toDate(s) ? `${s}T00:00:00.000Z` : null;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null;
  const withZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : s + 'Z';
  const t = new Date(withZone.replace(' ', 'T'));
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

const lead = s => String(s).trim().replace(/^[^\p{L}\p{N}]+/u, ''); // значок и пробелы в начале
const tail = s => s.replace(/^[\s—–\-:·,]+/, '').trim();

const PRIORITY = { p0: 'critical', p1: 'high', p2: 'normal', p3: 'low', blocker: 'critical', critical: 'critical', high: 'high', normal: 'normal', medium: 'normal', low: 'low' }; // medium = normal (16.11.2026, ST-74)
/** Словесная шкала приоритета (решение владелицы). Значение вне шкалы не угадывается — целиком в заметку. */
export function toPriority(v) {
  const s = lead(v);
  const m = s.match(/^(P[0-3]|blocker|critical|high|normal|medium|low)(?![\p{L}\p{N}_])/iu);
  if (!m) return { value: null, note: String(v).trim() };
  return { value: PRIORITY[m[1].toLowerCase()], note: tail(s.slice(m[0].length)) };
}

/** Статус → код из справочника типа и приписка. Не-статус: кода нет, весь текст — в приписку. */
export function splitStatus(v, codes) {
  const s = lead(v);
  for (const code of [...codes].sort((a, b) => b.length - a.length)) {
    const m = s.match(new RegExp('^' + code.replace(/_/g, '[ _]') + '(?![\\p{L}\\p{N}_])', 'iu'));
    if (m) return { code, note: tail(s.slice(m[0].length)) };
  }
  return { code: null, note: String(v).trim() };
}

const EXTRA_LABELS = { "READY FOR DEPLOY": "ready_for_deploy", "UAT TESTING": "uat" };
const SEP = /\s*(?:—|–|→|:|\(|·|\s-\s)\s*/u;
/**
 * Статус по каноническому словарю приложения (shared/lore-statuses.json, раздел statusMatch) — тем же
 * порядком, каким его сегодня опознаёт сервер: сначала значок, потом слово в начале строки.
 * Отличия от сервера: неузнанное не превращается в «todo», а остаётся без кода; канон, которого нет в
 * справочнике типа, кода не даёт. Приписка не теряется: при нестандартном написании в неё уходит вся строка.
 * strict — статусом считается только точное написание (для фаз: там в поле статуса лежали заголовки).
 */
export function classifyStatus(v, { vocab, codes, canonToCode = {}, strict = false }) {
  const raw = String(v).trim(), s = lead(raw), U = s.toUpperCase();
  const exact = { ...EXTRA_LABELS };
  for (const [canon, e] of Object.entries(vocab)) { exact[canon.toUpperCase()] = canon; exact[canon.toUpperCase().replace(/_/g, " ")] = canon; for (const w of e.words) exact[w] = canon; }
  const cut = s.search(SEP), phrase = (cut < 0 ? s : s.slice(0, cut)).trim().toUpperCase();
  let canon = exact[phrase] || null;
  if (!canon && !strict) {
    for (const [c, e] of Object.entries(vocab)) if (raw.startsWith(e.marker)) { canon = c; break; }
    if (!canon) outer: for (const [c, e] of Object.entries(vocab)) for (const w of e.words) if (U.startsWith(w)) { canon = c; break outer; }
  }
  const code = canon ? (canonToCode[canon] || canon) : null;
  // known: написание опознано как статус, но такого кода в справочнике типа нет — это не заголовок.
  if (!code || !codes.includes(code)) return canon ? { code: null, note: s, known: true, canon: code || canon } : { code: null, note: s };
  return { code, note: exact[phrase] === canon ? tail(cut < 0 ? "" : s.slice(cut)) : s };
}

// Куда решение человека запишет значение (target) — служебная пометка: в отчёты и в приёмник она не идёт,
// поэтому свойство неперечислимое и форма несоответствия {field, value, why} для читателей прежняя.
const reject = (r, field, value, why, target) => r.rejects.push(Object.defineProperty({ field, value, why }, 'target', { value: target, enumerable: false }));
const asDate = (f, v, r, to) => { const d = toDate(v); if (d === null) reject(r, f, v, 'не дата', { bucket: 'out', field: to }); else if (!given(r.out[to])) r.out[to] = d; };
const asDateTime = (f, v, r, to) => { const d = toDateTime(v); if (d === null) reject(r, f, v, 'не момент времени', { bucket: 'out', field: to }); else r.out[to] = d; };
const asPriority = (f, v, r, bucket) => { const p = toPriority(v); if (p.value === null) reject(r, f, v, 'приоритет вне шкалы', { bucket, field: 'priority', note: 'priority_note' }); else { r[bucket].priority = p.value; if (p.note) r[bucket].priority_note = p.note; } };
function asStatus(f, v, r, ctx, phase) {
  const codes = (ctx.statusCodes || {})[ctx.statusDict];
  if (!codes) throw new Error(`для ${f} не задан справочник статусов (ctx.statusDict)`);
  const st = ctx.statusVocab ? classifyStatus(v, { vocab: ctx.statusVocab, codes, canonToCode: ctx.canonToCode, strict: phase }) : splitStatus(v, codes);
  // Фаза: в истории лежат статусы задач (PARTIAL, READY FOR DEPLOY…). Сводим их к коду фазы тем же правилом,
  // что «статус фазы по задачам» (слово владелицы 16.11.2026; derive.map справочника фаз); прежний — в приписку.
  if (phase && st.code === null && st.known && ctx.phaseStatusMap) {
    const to = ctx.phaseStatusMap[String(st.canon).toUpperCase()];
    if (to) { r.out.status = ctx.codeCase === 'upper' ? to.toUpperCase() : to.toLowerCase(); r.out.status_note = st.note; return; }
  }
  r.out.status = st.code !== null && ctx.codeCase === 'upper' ? st.code.toUpperCase() : st.code;
  if (st.code === null) { if (phase && !st.known) r.titleFallback = st.note; else reject(r, f, v, 'статус вне справочника', { bucket: 'out', field: 'status', note: 'status_note' }); }
  else if (st.note) r.out.status_note = st.note;
}

// Преобразования, согласованные владелицей. Ключ — «Тип.поле».
const TRANSFORMS = {
  'KnowSprint.created_date': (f, v, r) => asDate(f, v, r, 'created_at'),
  'KnowSprint.date_created': (f, v, r) => asDate(f, v, r, 'created_at'),
  'KnowSprint.updated_at': (f, v, r) => asDateTime(f, v, r, 'updated_at'),
  'KnowTask.updated_at': (f, v, r) => asDateTime(f, v, r, 'updated_at'),
  'KnowSprintHist.planned_start_date': (f, v, r) => asDate(f, v, r, 'planned_start_date'),
  'KnowSprintHist.planned_end_date': (f, v, r) => asDate(f, v, r, 'planned_end_date'),
  'KnowSprintHist.priority': (f, v, r) => asPriority(f, v, r, 'out'),
  'KnowSprintHist.status_raw': (f, v, r, ctx) => asStatus(f, v, r, ctx, false),
  'KnowTaskHist.status_raw': (f, v, r, ctx) => asStatus(f, v, r, ctx, false),
  'KnowPhaseHist.status_raw': (f, v, r, ctx) => asStatus(f, v, r, ctx, true),
  'KnowPhase.phase_id': (f, v, r) => { r.out.phase_id = String(v).trim().replace(/^Фаза\s+/u, ''); },
};
const TYPE_ONLY = { DATE: asDate, DATETIME: asDateTime };
const TO_VERSION = { 'KnowSprint.priority': (f, v, r) => asPriority(f, v, r, 'toVersion') };
const RENAMES = {
  'KnowSprint.name': (v, rec) => (v === rec.sprint_id ? null : v),
};

export function applyMap(T, typeMap, record, ctx = {}) {
  const r = { out: {}, toVersion: {}, dropped: [], held: {}, rejects: [], titleFallback: null };
  for (const [f, v] of Object.entries(record)) {
    if (ENGINE.test(f)) continue;
    const e = typeMap[f];
    if (!e) throw new Error(`${T}.${f}: поля нет в карте переноса`);
    const k = `${T}.${f}`;
    if (e.rule === 'drop') { if (given(v)) r.dropped.push(f); continue; }
    if (!given(v)) continue;
    // Смена только вида хранения (дата, момент) — общее решение владелицы, от согласованности самого поля не зависит.
    if (e.rule === 'transform' && TYPE_ONLY[e.how] && !TRANSFORMS[k]) { TYPE_ONLY[e.how](f, v, r, e.to || f); continue; }
    if (e.rule === 'open' || (e.rule === 'transform' && e.basis !== 'owner')) { r.held[f] = v; continue; }
    if (e.rule === 'keep') { r.out[f] = v; continue; }
    if (e.rule === 'rename') {
      const nv = RENAMES[k] ? RENAMES[k](v, record) : v;
      if (nv === null) { if (!(e.to in r.out)) r.out[e.to] = null; } else if (!given(r.out[e.to])) r.out[e.to] = nv;
      continue;
    }
    if (e.rule === 'to_current_version') { if (TO_VERSION[k]) TO_VERSION[k](f, v, r); else r.toVersion[f] = v; continue; }
    if (e.rule === 'transform') {
      const fn = TRANSFORMS[k];
      if (!fn) throw new Error(`${k}: преобразование согласовано в карте, но не реализовано`);
      fn(f, v, r, ctx);
      continue;
    }
    throw new Error(`${k}: неизвестное правило «${e.rule}»`);
  }
  // MIG-02: решения человека о несоответствиях данных (раздел «Перенос») — после расчёта по карте.
  if (ctx.decisions) resolveRejects(T, r, ctx.decisions);
  return r;
}

/** Преобразования карты, для которых нет кода, — сторож полноты исполнителя. */
export function missingTransforms(types) {
  const out = [];
  for (const [T, fields] of Object.entries(types)) for (const [f, e] of Object.entries(fields)) if (e.rule === 'transform' && e.basis === 'owner' && !TRANSFORMS[`${T}.${f}`] && !TYPE_ONLY[e.how]) out.push(`${T}.${f}`);
  return out;
}
