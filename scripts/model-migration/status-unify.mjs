// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Унификация статусов перед переносом.
// Правило (rules/status-unification.json): в записи одно поле со статусом — код справочника; подписи на всех
// языках правила — только в справочнике. Здесь — проверка файла правил, сведение значения источника к коду
// и сборка диалога: что свелось само, что ждёт решения человека. Перенос не начинается, пока ждёт хоть одна
// строка. Решения — в файле решений (decisions.mjs); для статусов к его действиям добавлено add_code —
// «добавить код в справочник», обязательно с подписями на всех языках.
import { FORMAT as DECISIONS_FORMAT } from './decisions.mjs';

export const FORMAT = 'mig-status-rules/1';
export const LANGS = ['ru', 'en', 'pl'];
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
  if (rules.code_case !== 'upper' && rules.code_case !== 'lower') bad.push(`регистр кода «${rules.code_case}», бывает upper или lower`);
  for (const l of LANGS) if (!langs.includes(l)) bad.push(`в правилах не назван язык ${l}`);
  for (const [name, d] of Object.entries(rules.dictionaries || {})) {
    const codes = new Set();
    for (const c of d.codes || []) {
      if (blank(c.code)) { bad.push(`${name}: значение без кода`); continue; }
      if (codes.has(head(c.code))) bad.push(`${name}: код ${c.code} назван дважды`);
      codes.add(head(c.code));
      const want = rules.code_case === 'upper' ? String(c.code).toUpperCase() : String(c.code).toLowerCase();
      if (c.code !== want) bad.push(`${name}: код ${c.code} не в регистре правил (${rules.code_case}), ждали ${want}`);
      for (const l of langs) if (blank((c.labels || {})[l])) bad.push(`${name}.${c.code}: нет подписи на языке ${l}`);
    }
    if (!codes.size) bad.push(`${name}: справочник без значений`);
    for (const [from, to] of Object.entries(d.synonyms || {})) if (!codes.has(head(to))) bad.push(`${name}: синоним «${from}» ведёт к коду ${to}, которого в справочнике нет`);
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
    if (st.kind === 'empty' && !src.required) { rows.push({ ...row, state: 'unified', code: null }); continue; }
    const why = st.kind === 'empty' ? EMPTY : UNKNOWN;
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
    rows.push({
      ...row, state: 'needs_decision', why, ...(d ? { deferred: d.id } : {}),
      ...(st.kind === 'empty' ? { suggest: codes[0] } : {}),
      options: [{ action: 'map_to', codes }, { action: 'add_code', labels: rules.languages }, { action: 'defer' }],
    });
  }
  const waiting = rows.filter(r => r.state === 'needs_decision' || r.state === 'no_rule');
  const count = s => rows.filter(r => r.state === s).length;
  return {
    rows, added,
    summary: {
      unified: count('unified'), decided: count('decided'), needs_decision: count('needs_decision'), no_rule: count('no_rule'),
      records: rows.reduce((s, r) => s + r.n, 0), records_waiting: waiting.reduce((s, r) => s + r.n, 0),
    },
    ready: waiting.length === 0,
  };
}
