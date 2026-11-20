// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Унификация статусов перед переносом.
// Правило (rules/status-unification.json): в записи одно поле со статусом — код справочника; подписи на всех
// языках правила — только в справочнике. Здесь — проверка файла правил, сведение значения источника к коду
// и сборка диалога: что свелось само, что ждёт решения человека. Перенос не начинается, пока ждёт хоть одна
// строка. Решения — в файле решений (decisions.mjs); для статусов к его действиям добавлено add_code —
// «добавить код в справочник», обязательно с подписями на всех языках.
import { FORMAT as DECISIONS_FORMAT } from './decisions.mjs';

import { initialStatus, OWNER_RULE } from './empty-fill.mjs';
export const FORMAT = 'mig-status-rules/1';
export const LANGS = ['ru', 'en', 'pl'];
export const KINDS = ['status', 'other'];
export const EMPTY = 'пусто';
export const UNKNOWN = 'статус вне справочника';

const blank = v => v === null || v === undefined || String(v).trim() === '';
// «Голова» значения: без значка в начале и без приписки после разделителя, заглавными, пробел = подчёркивание.
const SEP = /\s*(?:—|–|→|:|\(|·|\s-\s)\s*/u;
const head = v => {
  const s = String(v).trim().replace(/^[^\p{L}\p{N}]+/u, '');
  const cut = s.search(SEP);
  return (cut < 0 ? s : s.slice(0, cut)).trim().toUpperCase().replace(/[\s_]+/gu, '_');
};

/** Причины, по которым файл правил не принимается; пусто — файл годен. */
export function checkRules(rules) {
  if (!rules || rules.format !== FORMAT) return [`формат файла правил «${rules && rules.format}», ждали «${FORMAT}»`];
  const bad = [];
  const langs = rules.languages || [];
  const cc = rules.code_case || {};
  for (const k of KINDS) if (cc[k] !== 'upper' && cc[k] !== 'lower') bad.push(`регистр кода для «${k}» — «${cc[k]}», бывает upper или lower`);
  for (const l of LANGS) if (!langs.includes(l)) bad.push(`в правилах не назван язык ${l}`);
  for (const [name, d] of Object.entries(rules.dictionaries || {})) {
    const codes = new Set();
    if (d.empty_default !== undefined && !(d.codes || []).some(c => c.code === d.empty_default)) bad.push(`${name}: статус по умолчанию ${d.empty_default} не из справочника`);
    if (!KINDS.includes(d.kind)) bad.push(`${name}: вид справочника «${d.kind}», бывает ${KINDS.join(' или ')}`);
    for (const c of d.codes || []) {
      if (blank(c.code)) { bad.push(`${name}: значение без кода`); continue; }
      if (codes.has(head(c.code))) bad.push(`${name}: код ${c.code} назван дважды`);
      codes.add(head(c.code));
      const want = cc[d.kind] === 'upper' ? String(c.code).toUpperCase() : String(c.code).toLowerCase();
      if (c.code !== want) bad.push(`${name}: код ${c.code} не в регистре правил (${cc[d.kind]}), ждали ${want}`);
      for (const l of langs) if (blank((c.labels || {})[l])) bad.push(`${name}.${c.code}: нет подписи на языке ${l}`);
    }
    if (!codes.size) bad.push(`${name}: справочник без значений`);
    if (d.derive) {
      const dv = d.derive;
      if (dv.from !== 'tasks_min') bad.push(`${name}: способ вывода «${dv.from}» неизвестен`);
      for (const c of [...(dv.order || []), ...Object.values(dv.map || {}), dv.empty]) if (!codes.has(head(c))) bad.push(`${name}: вывод по задачам ведёт к коду ${c}, которого в справочнике нет`);
    }
    for (const [from, to] of Object.entries(d.synonyms || {})) if (!codes.has(head(to))) bad.push(`${name}: синоним «${from}» ведёт к коду ${to}, которого в справочнике нет`);
  }
  const allCodes = new Set(Object.values(rules.dictionaries || {}).flatMap(d => (d.codes || []).map(c => c.code)));
  for (const [i, h] of (rules.hints || []).entries()) {
    if (!TIERS.includes(h.tier)) bad.push(`подсказка №${i + 1}: ярус «${h.tier}», бывают ${TIERS.join(', ')}`);
    if (h.tier !== 'not_status' && !allCodes.has(h.to)) bad.push(`подсказка №${i + 1} ведёт к коду ${h.to}, которого нет ни в одном справочнике`);
    try { rx(h); } catch (e) { bad.push(`подсказка №${i + 1}: шаблон не разбирается`); }
    if (!h.why) bad.push(`подсказка №${i + 1}: не сказано почему`);
  }
  const seen = new Set();
  for (const s of rules.sources || []) {
    if (!s.type || !s.field) { bad.push('источник без типа или поля'); continue; }
    if (!(rules.dictionaries || {})[s.dict]) bad.push(`${s.type}.${s.field}: справочника ${s.dict} в правилах нет`);
    const k = `${s.type}.${s.field}`;
    if (seen.has(k)) bad.push(`${k}: источник назван дважды`);
    seen.add(k);
  }
  return bad;
}

/** Значение источника → исход: known с кодом, empty или unknown. Незнакомое к коду не подтягивается. */
export function classify(value, dict) {
  if (blank(value)) return { kind: 'empty', code: null };
  const h = head(value);
  for (const c of dict.codes) if (head(c.code) === h) return { kind: 'known', code: c.code };
  for (const [from, to] of Object.entries(dict.synonyms || {})) if (head(from) === h) return { kind: 'known', code: to };
  return { kind: 'unknown', code: null };
}

export const TIERS = ['not_status', 'phrase', 'marker', 'word'];
// Без разметки: **жирное**, `код`, [текст](ссылка) → текст.
const plain = v => String(v).replace(/\*\*|`/gu, '').replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1').trim();
const rx = h => new RegExp(h.tier === 'marker' ? '^\\s*(?:' + h.match + ')' : h.match, 'iu');

/**
 * Предложение для значения, которое само к коду не свелось: по подсказкам правил (ярусы TIERS по порядку,
 * внутри — сверху вниз). Предлагается только код, который есть в справочнике типа. Ничего не подошло —
 * кода нет, причина названа. Это подсказка: решение принимает человек.
 */
export function suggest(value, dict, hints = [], dictName) {
  if (blank(value)) return { code: dict.empty_default || dict.codes[0].code, why: 'пустого статуса нет — статус по умолчанию справочника' };
  const codes = dict.codes.map(c => c.code), text = plain(value);
  const bare = text.replace(/^[^\p{L}\p{N}]+/u, ''), cut = bare.search(SEP);
  const headText = cut < 0 ? bare : bare.slice(0, cut);
  for (const tier of TIERS) {
    for (const h of hints) {
      if (h.tier !== tier || (h.dict && !h.dict.includes(dictName))) continue; // подсказка своего справочника без имени не применяется
      const m = rx(h).exec(tier === 'word' ? headText : text);
      if (!m) continue;
      const why = h.why + ' («' + m[0].trim() + '»)';
      if (tier === 'not_status') return { code: null, why };
      if (codes.includes(h.to)) return { code: h.to, why };
    }
  }
  return { code: null, why: dict.unrecognized_why || 'ни значок, ни слово не узнаны' };
}

/** Компоновка строк диалога: группы по предложенному коду в порядке справочника, без предложения — в конце. */
export function groupBySuggestion(rows) {
  const order = new Map();
  const groups = new Map();
  for (const r of rows) {
    const k = r.suggest ?? null;
    if (!groups.has(k)) groups.set(k, { code: k, rows: [], n: 0 });
    const g = groups.get(k); g.rows.push(r); g.n += r.n;
    if (k !== null && r.codes) r.codes.forEach((c, i) => order.set(c, i));
  }
  return [...groups.values()].sort((a, b) => (a.code === null) - (b.code === null) || (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
}

const sameValue = (a, b) => (blank(a) && blank(b)) || (!blank(a) && !blank(b) && String(a).trim() === String(b).trim());

function findDecision(decisions, row, why) {
  let byWhy = null;
  for (const d of decisions) {
    const s = d.scope || {};
    if (s.type !== row.type || s.field !== row.field) continue;
    if (s.value !== undefined && !blank(row.value) && sameValue(s.value, row.value)) return d; // значение сильнее причины
    if (s.why !== undefined && s.why === why) byWhy = d;
  }
  return byWhy;
}

/**
 * Диалог унификации. counts — что встречено в источнике: [{type, field, value, n}].
 * Строка: unified — свелось само; decided — закрыто решением; needs_decision — ждёт человека;
 * no_rule — у типа и поля нет правила (чужая установка). ready — переносить можно.
 */
/** Решения, которые нельзя записать: «свести к коду», которого нет в справочнике поля (и он не добавлен решением).
 *  Проверка ДО записи файла решений: 16.11.2026 такое решение записалось, и файл перестал читаться. */
export function decisionsAgainstRules(rules, decisionsDoc) {
  const bad = [], list = (decisionsDoc && decisionsDoc.decisions) || [];
  const added = list.filter(d => d.action === 'add_code').map(d => ({ src: statusDictOf(rules, d.scope), code: d.to }));
  for (const d of list) {
    if (d.action !== 'map_to') continue;
    const dn = statusDictOf(rules, d.scope), dict = dn && rules.dictionaries[dn];
    if (!dict) continue;
    if (!dict.codes.some(c => c.code === d.to) && !added.some(a => a.src === dn && a.code === d.to)) bad.push(`решение ${d.id}: кода ${d.to} в справочнике ${dn} нет`);
  }
  return bad;
}

export function buildDialog(counts, rules, decisionsDoc) {
  const problems = checkRules(rules);
  if (problems.length) throw new Error('файл правил не принят: ' + problems.join('; '));
  if (!decisionsDoc || decisionsDoc.format !== DECISIONS_FORMAT) throw new Error(`формат файла решений «${decisionsDoc && decisionsDoc.format}», ждали «${DECISIONS_FORMAT}»`);
  const decisions = decisionsDoc.decisions || [];
  const bySource = new Map(rules.sources.map(s => [`${s.type}.${s.field}`, s]));
  const rows = [], added = [];
  for (const c of counts) {
    const src = bySource.get(`${c.type}.${c.field}`);
    const row = { type: c.type, field: c.field, value: blank(c.value) ? null : c.value, n: c.n };
    if (!src) { rows.push({ ...row, state: 'no_rule', why: 'у типа и поля нет правила статуса' }); continue; }
    const dict = rules.dictionaries[src.dict], codes = dict.codes.map(x => x.code);
    const st = classify(c.value, dict);
    row.dict = src.dict;
    if (st.kind === 'known') { rows.push({ ...row, state: 'unified', code: st.code }); continue; }
    // Пустой статус (правило владелицы 19.11.2026) решения не ждёт: начальный статус справочника, а решение человека
    // из файла (если есть) — поверх него. Пустое не-статусное необязательное поле остаётся пустым.
    if (st.kind === 'empty' && !src.required && initialStatus(dict) === null && !dict.derive) { rows.push({ ...row, state: 'unified', code: null }); continue; }
    // Справочник с правилом вывода (фаза — по задачам): код считается при переносе, решения человека не ждёт.
    if (dict.derive) { rows.push({ ...row, state: 'unified', code: null, derived: dict.derive.from }); continue; }
    const why = st.kind === 'empty' ? EMPTY : dict.kind === 'status' ? UNKNOWN : 'значение вне справочника';
    const d = findDecision(decisions, row, why);
    if (d && d.action !== 'defer') {
      const at = `решение ${d.id}`;
      if (d.action === 'map_to') {
        if (!codes.includes(d.to) && !added.some(a => a.dict === src.dict && a.code === d.to)) throw new Error(`${at}: кода ${d.to} в справочнике ${src.dict} нет`);
        rows.push({ ...row, state: 'decided', code: d.to, decision: d.id, why });
      } else if (d.action === 'add_code') {
        if (blank(d.to)) throw new Error(`${at}: не назван добавляемый код`);
        for (const l of rules.languages) if (blank((d.labels || {})[l])) throw new Error(`${at}: у добавляемого кода ${d.to} нет подписи на языке ${l}`);
        if (!codes.includes(d.to) && !added.some(a => a.dict === src.dict && a.code === d.to)) added.push({ dict: src.dict, code: d.to, labels: Object.fromEntries(rules.languages.map(l => [l, d.labels[l]])) });
        rows.push({ ...row, state: 'decided', code: d.to, decision: d.id, why });
      } else if (d.action === 'drop' || d.action === 'to_note') {
        if (src.required && d.action === 'drop') throw new Error(`${at}: статус ${row.type} обязателен — «не переносить» оставило бы запись без статуса`);
        rows.push({ ...row, state: 'decided', code: null, decision: d.id, action: d.action, why });
      } else throw new Error(`${at}: действие «${d.action}» к статусу неприменимо`);
      continue;
    }
    if (why === EMPTY && initialStatus(dict) !== null) {
      const sg = suggest(c.value, dict, rules.hints || [], src.dict);
      rows.push({ ...row, state: 'defaulted', code: initialStatus(dict), basis: OWNER_RULE, why, ...(d ? { deferred: d.id } : {}), suggest: sg.code, suggestWhy: sg.why, codes });
      continue;
    }
    rows.push({
      ...row, state: 'needs_decision', why, ...(d ? { deferred: d.id } : {}),
      ...(() => { const sg = suggest(c.value, dict, rules.hints || [], src.dict); return { suggest: sg.code, suggestWhy: sg.why, codes }; })(),
      options: [{ action: 'map_to', codes }, { action: 'add_code', labels: rules.languages }, { action: 'defer' }],
    });
  }
  const waiting = rows.filter(r => r.state === 'needs_decision' || r.state === 'no_rule');
  const count = s => rows.filter(r => r.state === s).length;
  return {
    rows, added,
    summary: {
      unified: count('unified'), defaulted: count('defaulted'), decided: count('decided'), needs_decision: count('needs_decision'), no_rule: count('no_rule'),
      records: rows.reduce((s, r) => s + r.n, 0), records_waiting: waiting.reduce((s, r) => s + r.n, 0),
    },
    ready: waiting.length === 0,
  };
}

/** Справочник, к которому относится область решения (тип и поле источника); нет правила — null. */
export function statusDictOf(rules, scope) {
  const s = (rules.sources || []).find(x => x.type === scope.type && x.field === scope.field);
  return s ? s.dict : null;
}

/** Статус фазы по задачам: самый ранний этап пути среди неотменённых задач (правило derive справочника). */
export function derivePhaseStatus(taskCodes, derive) {
  const odd = [], stages = [];
  let skipped = 0;
  for (const t of taskCodes) {
    if ((derive.skip || []).includes(t)) { skipped++; continue; }
    const m = derive.map[t];
    if (m) stages.push(m); else odd.push(t);
  }
  if (!stages.length) {
    const why = taskCodes.length ? `все ${skipped} задач отменены` + (odd.length ? `, незнакомые статусы: ${odd.join(', ')}` : '') : 'задач нет';
    return { code: derive.empty, why: `${why} — статус по умолчанию ${derive.empty}` };
  }
  const code = derive.order.find(o => stages.includes(o));
  return { code, why: `минимальный по ${stages.length} задач фазы` + (skipped ? `, отменённых не считали: ${skipped}` : '') + (odd.length ? `; незнакомые статусы задач: ${odd.join(', ')}` : '') };
}
