// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Решения человека о несоответствиях данных.
// Перенос находит несоответствия сам (rejects исполнителя карты); этот файл хранит только то, что человек
// решил в разделе «Перенос». Решение — правило: действует на все записи с таким значением и переживает
// повторный перенос со свежего снимка. Файл переносится на другую установку как есть.
//
// Формат (rules/decisions.json):
//   { "format": "mig-decisions/1", "decisions": [
//       { "id": "…", "scope": { "type": "KnowSprintHist", "field": "priority", "value": "medium" },
//         "action": "map_to", "to": "normal", "by": "кто принял", "at": "когда (ISO-8601)", "note": "…" } ] }
// scope: значение (точное совпадение без крайних пробелов) ЛИБО причина (why) — тогда решение на всё поле.
// Действия:
//   map_to  — свести к значению `to`;
//   add_code — статус: добавить в справочник код `to` с подписями `labels` на всех языках правил и свести к нему
//              (status-unify.mjs; на другой установке статусы свои, их вводят решением, а не правкой правил);
//   to_note — поле пустое, исходное значение уходит в заметку поля (если заметка у поля есть);
//   drop    — не переносить (значение названо в принятых, молча не пропадает);
//   defer   — решу позже: несоответствие остаётся и помечается кодом решения.

export const FORMAT = 'mig-decisions/1';
//   link    — только область decision_refs (шаг мастера «Ссылки решений», decision-refs.mjs): ссылка решения
//              scope.decision со значением scope.value в поле scope.field → связь к цели `to` (однозначный ключ цели);
//              там же drop — «не ставить связь» (остаток «решено человеком»), defer — «решу позже» (остаток «ждёт решения»).
export const ACTIONS = ['map_to', 'add_code', 'to_note', 'drop', 'defer', 'link'];
const REFS_SCOPE = 'decision_refs', REFS_ACTIONS = ['link', 'drop', 'defer'];

const norm = v => String(v).trim();
const blankStr = v => v === undefined || v === null || String(v).trim() === '';
const scopeKey = s => `${s.type}.${s.field}|${s.type === REFS_SCOPE ? 'd:' + s.decision + '|' : ''}${s.value !== undefined ? 'v:' + norm(s.value) : 'w:' + s.why}`;

/** Причины, по которым файл решений не принимается; пусто — файл годен. */
export function checkDecisions(doc) {
  const bad = [];
  if (!doc || doc.format !== FORMAT) return [`формат файла решений «${doc && doc.format}», ждали «${FORMAT}»`];
  const seen = new Map();
  for (const [i, d] of (doc.decisions || []).entries()) {
    const at = d.id ? `решение ${d.id}` : `решение №${i + 1}`;
    if (!d.id) bad.push(`${at}: нет кода`);
    const s = d.scope || {};
    if (!s.type || !s.field) bad.push(`${at}: не названы тип и поле`);
    if ((s.value === undefined) === (s.why === undefined)) bad.push(`${at}: в области нужно одно из двух — значение или причина`);
    if (!ACTIONS.includes(d.action)) bad.push(`${at}: действие «${d.action}», бывают ${ACTIONS.join(', ')}`);
    if (s.type === REFS_SCOPE) {
      if (blankStr(s.decision)) bad.push(`${at}: в области ${REFS_SCOPE} не названо решение`);
      if (s.value === undefined) bad.push(`${at}: в области ${REFS_SCOPE} нужен исходный текст ссылки`);
      if (!REFS_ACTIONS.includes(d.action)) bad.push(`${at}: для ссылки решения бывают ${REFS_ACTIONS.join(', ')}, а не «${d.action}»`);
      if (d.action === 'link' && blankStr(d.to)) bad.push(`${at}: не сказано, какую цель связать`);
    } else if (d.action === 'link') bad.push(`${at}: действие link — только для области ${REFS_SCOPE}`);
    if ((d.action === 'map_to' || d.action === 'add_code') && (d.to === undefined || d.to === null || d.to === '')) bad.push(`${at}: не сказано, к какому значению свести`);
    if (d.action === 'add_code' && (!d.labels || typeof d.labels !== 'object' || !Object.keys(d.labels).length)) bad.push(`${at}: у добавляемого кода нет подписей`);
    if (!d.by || !String(d.by).trim()) bad.push(`${at}: не сказано, кто принял`);
    if (!d.at || Number.isNaN(Date.parse(d.at))) bad.push(`${at}: не сказано, когда принято`);
    if (s.type && s.field) {
      const k = scopeKey(s);
      if (seen.has(k)) bad.push(`${at}: два решения на одну область — с ${seen.get(k)}`);
      else seen.set(k, d.id || `№${i + 1}`);
    }
  }
  return bad;
}

function find(decisions, T, reject) {
  let byWhy = null;
  for (const d of decisions) {
    const s = d.scope;
    if (s.type !== T || s.field !== reject.field) continue;
    if (s.value !== undefined && norm(s.value) === norm(reject.value)) return d; // точное значение сильнее причины
    if (s.why !== undefined && s.why === reject.why) byWhy = d;
  }
  return byWhy;
}

/**
 * Применить решения к несоответствиям одной записи. Меняет `r`: принятые уходят из rejects в decided,
 * отложенные остаются в rejects с пометкой. Несоответствие без решения не трогается.
 */
export function resolveRejects(T, r, doc) {
  const problems = checkDecisions(doc);
  if (problems.length) throw new Error('файл решений не принят: ' + problems.join('; '));
  const left = [];
  r.decided = r.decided || [];
  for (const x of r.rejects) {
    // Копия статуса на записи следует решению по версиям того же типа (17.11.2026): своё решение для записи сильнее.
    const d = find(doc.decisions, T, x) || (T.endsWith("Hist") ? null : find(doc.decisions, T + "Hist", x));
    if (!d) { left.push(x); continue; }
    if (d.action === 'defer') { left.push({ ...x, deferred: d.id }); continue; }
    const t = x.target;
    if (d.action !== 'drop') {
      if (!t) throw new Error(`${T}.${x.field}: у несоответствия не названо, куда писать значение, — решение ${d.id} применить нельзя`);
      if (d.action === 'map_to' || d.action === 'add_code') r[t.bucket][t.field] = d.to;
      else if (!t.note) throw new Error(`${T}.${x.field}: у поля нет заметки — «текст в заметку» (решение ${d.id}) потерял бы значение`);
      else r[t.bucket][t.note] = String(x.value);
    }
    r.decided.push({ field: x.field, value: x.value, decision: d.id, action: d.action });
  }
  r.rejects = left;
  return r;
}

import fs from 'node:fs';

/**
 * Решения установки: файл `rules/decisions.json` рядом с конвейером либо путь из MIG_DECISIONS_FILE.
 * Файла нет — решений нет (`undefined`): несоответствия остаются несоответствиями. Негодный файл — отказ.
 */
// Файл решений задаётся путём (--decisions установщика или MIG_DECISIONS_FILE): установщик живёт и в исполняемом
// файле, где рядом с модулем нет каталога rules/. Не задан — решений нет.
export function loadDecisions(file = process.env.MIG_DECISIONS_FILE) {
  if (!file) return undefined;
  if (!fs.existsSync(file)) return undefined;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = checkDecisions(doc);
  if (problems.length) throw new Error('файл решений не принят: ' + problems.join('; '));
  return doc;
}
