import { classify as classifyRules, EMPTY } from './status-unify.mjs';
import HARNESS_RULES_FILE from './rules/status-unification.json' with { type: 'json' };
import LORE_MODEL from '../../shared/model/lore-model.json' with { type: 'json' };
import { notNullOfModel } from './notnull.mjs';
import { statusSourceOf, fillEmptyStatus } from './empty-fill.mjs';
import { RULES as STATUS_RULES } from './resources.mjs';
import { legacyGiven } from './legacy.mjs';
const HARNESS_RULES = HARNESS_RULES_FILE.dictionaries.harness;
// MDL-11 (ответ владелицы 19.11.2026 «5а»): обязательное по модели поле (notnull — в базе MANDATORY + NOTNULL) пустым
// не пропускается молча. Пустой статус закрывает общее правило (empty-fill.mjs, правило владелицы 19.11): вычислить →
// выбор из файла решений → начальный статус справочника. Прочее обязательное поле без значения — несоответствие «пусто»;
// без решения запись не пишется: сторож notNullMissing в transfer.mjs.
const NOT_NULL = notNullOfModel(LORE_MODEL);
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
//   legacy        — значения снятых легаси-полей (MDL-08, правило drop + legacy): вызывающий код кладёт их в остаток;
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

/**
 * MDL-06 · ссылки на PR (pr_refs) — к одному виду. В проде поле лежит числом, строкой номеров, списком,
 * ссылками markdown на PR (GitHub, Forgejo) и вперемешку со ссылками на релизы. Вид результата один:
 * { prs: ['хост/владелец/репозиторий#N' | '#N', …], note?: 'остаток' }. Номер без адреса — '#N', репозиторий
 * не угадывается (его решит шаг связей, MD-05). Остаток — ссылки на релизы и приписки — в note, не теряется.
 */
export function toPrRefs(v) {
  const prs = [], rest = [];
  const add = p => { if (!prs.includes(p)) prs.push(p); };
  const LINK = /\[([^\]]*)\]\(([^)\s]*)\)/g;
  const FILLER = /^(?:PR|[^\p{L}\p{N}]+)$/iu; // «PR», «·», «→», «,» — связки между ссылками
  const one = x => {
    if (typeof x === 'number') { add(`#${x}`); return; }
    const s = String(x);
    const text = s.replace(LINK, (all, label, url) => {
      const u = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)(?:\/pulls?)?\/(\d+)\/?$/);
      const n = label.match(/#\s*(\d+)/);
      if (u && (n || /\/pulls?\//.test(url))) { add(`${u[1]}/${u[2]}/${u[3]}#${/\/pulls?\//.test(url) ? u[4] : n[1]}`); return ' '; }
      rest.push(all); return ' ';
    });
    for (const t of text.split(/[\s,;]+/).filter(Boolean)) {
      const m = t.match(/^(?:PR)?#?(\d+)$/i);
      if (m) add(`#${m[1]}`); else if (!FILLER.test(t)) rest.push(t);
    }
  };
  for (const x of Array.isArray(v) ? v : [v]) one(x);
  const note = rest.join(' ').trim();
  return note ? { prs, note } : { prs };
}
// Вид удержанного значения: поле ждёт шага связей, но в остаток ложится уже приведённым (MDL-06).
const HELD_FORM = { pr_refs: toPrRefs };

const lead = s => String(s).trim().replace(/^[^\p{L}\p{N}]+/u, ''); // значок и пробелы в начале
const tail = s => s.replace(/^[\s—–\-:·,]+/, '').trim();

const DECIDED = new Set(['owner', 'delegated']);
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
  // Все объекты (17.11.2026): коды справочника берутся и из правил переноса, если в базе их нет.
  const codes = (ctx.statusCodes || {})[ctx.statusDict] || (ctx.statusRules ? ctx.statusRules.codes.map(c => c.code.toLowerCase()) : undefined);
  if (!codes) throw new Error(`для ${f} не задан справочник статусов (ctx.statusDict)`);
  const st = ctx.statusVocab ? classifyStatus(v, { vocab: ctx.statusVocab, codes, canonToCode: ctx.canonToCode, strict: phase }) : splitStatus(v, codes);
  // Фаза: в истории лежат статусы задач (PARTIAL, READY FOR DEPLOY…). Сводим их к коду фазы тем же правилом,
  // что «статус фазы по задачам» (слово владелицы 16.11.2026; derive.map справочника фаз); прежний — в приписку.
  if (phase && st.code === null && st.known && ctx.phaseStatusMap) {
    const to = ctx.phaseStatusMap[String(st.canon).toUpperCase()];
    if (to) { r.out.status = ctx.codeCase === 'upper' ? to.toUpperCase() : to.toLowerCase(); r.out.status_note = st.note; return; }
  }
  // Не узнал словарь приложения — тот же разбор, что в диалоге статусов (коды и синонимы справочника правил).
  if (st.code === null && ctx.statusRules) { const k = classifyRules(v, ctx.statusRules); if (k.kind === 'known') { st.code = k.code.toLowerCase(); st.note = ''; } }
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
  'KnowTask.priority': (f, v, r) => asPriority(f, v, r, 'out'),
  'KnowSprintHist.status_raw': (f, v, r, ctx) => asStatus(f, v, r, ctx, false),
  'KnowTaskHist.status_raw': (f, v, r, ctx) => asStatus(f, v, r, ctx, false),
  'KnowPhaseHist.status_raw': (f, v, r, ctx) => asStatus(f, v, r, ctx, true),
  'KnowPhase.phase_id': (f, v, r) => { r.out.phase_id = String(v).trim().replace(/^Фаза\s+/u, ''); },
};
const TYPE_ONLY = { DATE: asDate, DATETIME: asDateTime };
// Общие преобразования карты всех объектов (17.11.2026): статус — к справочнику типа, приоритет — к одной шкале.
// harness — по справочнику правил проверки и унификации (rules/status-unification.json, 17.11.2026).
const asHarness = (f, v, r, ctx) => { const d = (ctx.harnessRules || HARNESS_RULES); const k = classifyRules(v, d); if (k.kind === 'known') r.out.harness = k.code; else reject(r, f, v, 'harness вне справочника miniLORE', { bucket: 'out', field: 'harness' }); };
const GENERIC = { harness: asHarness, status: (f, v, r, ctx) => asStatus(f, v, r, ctx, false), priority: (f, v, r) => asPriority(f, v, r, 'out') };
const TO_VERSION = { 'KnowSprint.priority': (f, v, r) => asPriority(f, v, r, 'toVersion') };
const RENAMES = {
  'KnowSprint.name': (v, rec) => (v === rec.sprint_id ? null : v),
};

export function applyMap(T, typeMap, record, ctx = {}) {
  const r = { out: {}, toVersion: {}, dropped: [], legacy: {}, held: {}, rejects: [], titleFallback: null, filled: [] };
  for (const [f, v] of Object.entries(record)) {
    if (ENGINE.test(f)) continue;
    const e = typeMap[f];
    if (!e) throw new Error(`${T}.${f}: поля нет в карте переноса`);
    const k = `${T}.${f}`;
    if (e.rule === 'drop' && e.legacy) { if (legacyGiven(v)) { r.dropped.push(f); r.legacy[f] = v; } continue; }
    if (e.rule === 'drop') { if (given(v)) r.dropped.push(f); continue; }
    if (!given(v)) continue;
    // Смена только вида хранения (дата, момент) — общее решение владелицы, от согласованности самого поля не зависит.
    if (e.rule === 'transform' && TYPE_ONLY[e.how] && !TRANSFORMS[k]) { TYPE_ONLY[e.how](f, v, r, e.to || f); continue; }
    // delegated — владелица поручила решить исполнителю (16.11.2026: «по максимуму сама»): действует как её решение,
    // но в карте остаётся различимым, чтобы его можно было переиграть.
    if (e.rule === 'open' || (e.rule === 'transform' && !DECIDED.has(e.basis))) { r.held[f] = HELD_FORM[f] ? HELD_FORM[f](v) : v; continue; }
    if (e.rule === 'keep') { r.out[f] = v; continue; }
    if (e.rule === 'rename') {
      const nv = RENAMES[k] ? RENAMES[k](v, record) : v;
      if (nv === null) { if (!(e.to in r.out)) r.out[e.to] = null; } else if (!given(r.out[e.to])) r.out[e.to] = nv;
      continue;
    }
    if (e.rule === 'to_current_version') { if (TO_VERSION[k]) TO_VERSION[k](f, v, r); else r.toVersion[f] = v; continue; }
    if (e.rule === 'transform') {
      const fn = TRANSFORMS[k] || (GENERIC[e.how] && ((f2, v2, r2, c2) => GENERIC[e.how](f2, v2, r2, c2)));
      if (!fn) throw new Error(`${k}: преобразование согласовано в карте, но не реализовано`);
      fn(f, v, r, ctx);
      continue;
    }
    throw new Error(`${k}: неизвестное правило «${e.rule}»`);
  }
  // Правило владелицы 19.11.2026: пустой статус — начальный (empty-fill.mjs). Значение было, но не свелось, —
  // это не «пусто», а несоответствие «вне справочника», его правило не трогает. deferEmpty — перенос сначала
  // вычисляет из данных (computeEmptyStatuses после сведения версий), поэтому здесь только помечает.
  const src = statusSourceOf(T, typeMap, ctx.statusRulesAll || STATUS_RULES);
  if (src && !given(r.out.status) && !Object.keys(typeMap).some(f => (typeMap[f].to || f) === 'status' && typeMap[f].rule !== 'drop' && given(record[f]))) {
    if (ctx.deferEmpty) r.emptyStatus = src;
    else fillEmptyStatus(T, r, { ...ctx, statusRules: ctx.statusRules || (ctx.statusRulesAll || STATUS_RULES).dictionaries[src.dict], source: src });
  }
  for (const to of NOT_NULL[T] || []) {
    if (given(r.out[to]) || (to === 'status' && r.emptyStatus)) continue;
    const src = Object.keys(typeMap).filter(f => (typeMap[f].to || f) === to && typeMap[f].rule !== 'drop');
    if (src.some(f => given(record[f]))) continue; // значение было, но не привелось — несоответствие уже названо
    reject(r, src[0] || to, '', EMPTY, { bucket: 'out', field: to, ...(to === 'status' ? { note: 'status_note' } : {}) });
  }
  // MIG-02: решения человека о несоответствиях данных (раздел «Перенос») — после расчёта по карте.
  if (ctx.decisions) resolveRejects(T, r, ctx.decisions);
  return r;
}

/** Преобразования карты, для которых нет кода, — сторож полноты исполнителя. */
export function missingTransforms(types) {
  const out = [];
  for (const [T, fields] of Object.entries(types)) for (const [f, e] of Object.entries(fields)) if (e.rule === 'transform' && DECIDED.has(e.basis) && !TRANSFORMS[`${T}.${f}`] && !TYPE_ONLY[e.how] && !GENERIC[e.how]) out.push(`${T}.${f}`);
  return out;
}
