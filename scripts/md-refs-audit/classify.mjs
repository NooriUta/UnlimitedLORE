// Классификатор упоминаний объектов LORE в MD (SPRINT_UXR_POLISH_UAT_1113/PU-15).
//
// Чистая функция: текст + справочник существующих ID → список упоминаний с классом.
// Формы — те же, что у splitLoreRefs (miniLORE, app_flutter/lib/src/data/lore_refs.dart)
// и kit/src/content/markdownWiki.ts; канон — SPEC-LORE-MD-INLINE-REF §1 и правило
// «Как писать идентификаторы LORE» глобального CLAUDE.md.

/** Типы, которые читатели умеют открывать по `тип:ID` (список splitLoreRefs). */
export const TYPED = [
  'task', 'adr', 'spec', 'decision', 'sprint', 'release',
  'doc', 'runbook', 'component',
  'uc', 'feature', 'question', 'pain', 'gain', 'job', 'actor', 'agent_actor',
];

/** Семейства «по виду»: приставка → тип (одна таблица, как _families в lore_refs.dart). */
export const FAMILIES = [
  { type: 'adr', re: /ADR-[A-Z0-9]+-\d+[A-Z0-9-]*/y },
  { type: 'decision', re: /D-\d{4}-[A-Z0-9-]+/y },
  { type: 'spec', re: /SPEC-[A-Z0-9-]+/y },
  { type: 'runbook', re: /RUNBOOK-[A-Z0-9-]+/y },
  { type: 'pain', re: /PAIN-[A-Z0-9-]+/y },
  { type: 'gain', re: /GAIN-[A-Z0-9-]+/y },
  { type: 'uc', re: /UC-[A-Z0-9-]+/y },
  { type: 'feature', re: /FEAT-[A-Z0-9-]+/y },
  { type: 'actor', re: /ACT-[A-Z0-9-]+/y },
  { type: 'agent_actor', re: /AGENT-[A-Za-z0-9_-]+/y },
  { type: 'question', re: /Q-[A-Z][A-Z0-9-]{2,}/y },
];

/** Классы. Канон — то, что правило разрешает; остальное — нарушения или справка. */
export const CLASSES = {
  wiki_typed:   { group: 'canon', title: 'wiki с типом [[тип:ID]]' },
  wiki_bare:    { group: 'canon', title: 'wiki без типа [[ID]]' },
  typed:        { group: 'canon', title: 'с типом тип:ID' },
  tana:         { group: 'canon', title: 'tana @ID / #тип ID' },
  shape:        { group: 'canon', title: 'по виду (голый ID узнаваемой формы)' },
  backtick:     { group: 'violation', title: 'ID в обратных кавычках' },
  lone_task:    { group: 'violation', title: 'одинокий код задачи без спринта' },
  lone_task_wiki: { group: 'violation', title: 'одинокий код задачи в [[…]]' },
  wiki_unknown: { group: 'violation', title: '[[…]] с неизвестным типом или видом' },
  wiki_escaped: { group: 'violation', title: 'экранированная \\[\\[…\\]\\] (ссылка потеряна)' },
  url_lore:     { group: 'violation', title: 'URL экрана LORE (:4400/lore?…, new.lore…)' },
  url_github:   { group: 'violation', title: 'GitHub-ссылка' },
  url_forgejo:  { group: 'info', title: 'URL Forgejo (PR/файл)' },
  codeblock:    { group: 'info', title: 'ID внутри блока кода ```' },
};

const TASK_RE = /SPRINT_[A-Z0-9_]+\/[A-Za-z0-9._-]+/y;
const SPRINT_RE = /SPRINT_[A-Z0-9_]+/y;
const DOC_SLUG = /^[a-z0-9]+(_[a-z0-9]+)+$/;
const TRAIL = '.,;:!?)]}»"\'';

const URL_RE = /https?:\/\/[^\s<>()\]`"']+|(?<![\w/])\/lore\?[^\s<>()\]`"']+/g;

function urlClass(u) {
  if (/github\.com\//i.test(u)) return 'url_github';
  // Ссылка на ОБЪЕКТ через экран LORE: путь /lore?… или параметр open=/passport=. Голый адрес
  // стенда (`http://…:4400` в настройке) объектом не является и сюда не попадает.
  if (/(\/lore\?|[?&](open|passport)=)/i.test(u)
    && /(:44\d\d\b|new\.lore|lore\.odal|^\/lore\?|localhost|127\.0\.0\.1|192\.168\.)/i.test(u)) return 'url_lore';
  if (/(git\.seidrstudio\.pro|:3030\/)/i.test(u)) return 'url_forgejo';
  return null;
}

/** Тип по виду ID, без БД. null — вид молчит. */
export function typeFromShape(id) {
  if (id.startsWith('SPRINT_')) return id.includes('/') ? 'task' : 'sprint';
  for (const f of FAMILIES) {
    f.re.lastIndex = 0;
    const m = f.re.exec(id);
    if (m && m[0].length === id.length) return f.type;
  }
  return null;
}

/**
 * Разбивка MD на куски: проза, inline-код, блок кода. Смещения не нужны — классы
 * считаются по кускам. Блоки — строки, открытые ``` или ~~~ (как CommonMark, упрощённо).
 */
export function segments(md) {
  const out = [];
  const lines = md.split(/\r?\n/);
  let fence = null; let buf = [];
  const flush = (kind) => { if (buf.length) out.push({ kind, text: buf.join('\n') }); buf = []; };
  for (const line of lines) {
    const fm = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) { flush('fence'); fence = null; }
      else buf.push(line);
      continue;
    }
    if (fm) { flush('prose'); fence = fm[1]; continue; }
    buf.push(line);
  }
  flush(fence ? 'fence' : 'prose');
  // inline-код внутри прозы
  const res = [];
  for (const s of out) {
    if (s.kind !== 'prose') { res.push(s); continue; }
    const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;
    let at = 0; let m;
    while ((m = re.exec(s.text))) {
      if (m.index > at) res.push({ kind: 'prose', text: s.text.slice(at, m.index) });
      res.push({ kind: 'inline', text: m[2] });
      at = m.index + m[0].length;
    }
    if (at < s.text.length) res.push({ kind: 'prose', text: s.text.slice(at) });
  }
  return res;
}

// «@» слева — почта или tana (tana забрана раньше), не начало голого ID.
const isIdChar = (c) => c !== undefined && /[A-Za-z0-9_\-/.@]/.test(c);

/**
 * Все ID-подобные вхождения в куске текста (без учёта рода куска).
 * Возвращает [{start,end,form,type,id}] без перекрытий; form: wiki|wiki_escaped|typed|tana|shape|lone.
 * @param ctx.taskCodes Map<код задачи, число задач с этим кодом> — для «одиноких» кодов.
 */
export function scanRefs(text, ctx) {
  const hits = [];
  const taken = (s, e) => hits.some((h) => s < h.end && h.start < e);
  const push = (h) => { if (!taken(h.start, h.end)) hits.push(h); };

  // 0. URL — забираем первыми, чтобы ID внутри адреса не считались второй раз.
  for (const m of text.matchAll(URL_RE)) {
    let u = m[0];
    while (u && TRAIL.includes(u[u.length - 1])) u = u.slice(0, -1);
    const cls = urlClass(u);
    if (cls) push({ start: m.index, end: m.index + u.length, form: cls, type: null, id: u });
    else push({ start: m.index, end: m.index + u.length, form: 'url_other', type: null, id: u });
  }
  // markdown-ссылка [текст](url-LORE/GitHub): текст ссылки — часть того же нарушения.
  for (const m of text.matchAll(/\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]+|\/lore\?[^)\s]+)\)/g)) {
    const urlStart = m.index + m[0].indexOf('(') + 1;
    const h = hits.find((x) => x.start === urlStart);
    if (h) { h.start = m.index; h.end = m.index + m[0].length; h.label = m[1]; }
  }

  // 1. wiki, в том числе экранированная (\[\[…\]\] — так её пишет сериализатор без markdownLossless).
  for (const m of text.matchAll(/\\\[\\\[([^\[\]\n\\]{1,200})\\\]\\\]/g)) {
    push({ start: m.index, end: m.index + m[0].length, form: 'wiki_escaped', type: null, id: m[1].trim() });
  }
  for (const m of text.matchAll(/\[\[([^\[\]\n]{1,200})\]\]/g)) {
    if (taken(m.index, m.index + m[0].length)) continue;
    const inner = m[1].trim();
    const t = /^([a-z_]+):(.+)$/i.exec(inner);
    if (t) {
      const type = t[1].toLowerCase();
      push({ start: m.index, end: m.index + m[0].length, form: 'wiki', typedIn: true,
        type: TYPED.includes(type) ? type : null, rawType: type, id: t[2].trim() });
    } else {
      let type = typeFromShape(inner);
      if (!type && DOC_SLUG.test(inner)) type = 'doc';
      push({ start: m.index, end: m.index + m[0].length, form: 'wiki', typedIn: false, type, id: inner });
    }
  }

  // 2. С типом: тип:ID (тип — из списка читателей).
  const typedRe = new RegExp(`(?<![\\w])(${TYPED.join('|')}):([A-Za-z0-9._/#-]+)`, 'gi');
  for (const m of text.matchAll(typedRe)) {
    let id = m[2];
    while (id && TRAIL.includes(id[id.length - 1])) id = id.slice(0, -1);
    if (!id) continue;
    push({ start: m.index, end: m.index + m[1].length + 1 + id.length, form: 'typed', type: m[1].toLowerCase(), id });
  }

  // 3. tana: @ID (после пробела/начала) и #тип ID / #тип:ID.
  for (const m of text.matchAll(/(?<![\w@])@((?:SPRINT_[A-Z0-9_]+(?:\/[A-Za-z0-9._-]+)?)|(?:[A-Z]{1,7}-[A-Za-z0-9_-]+))/g)) {
    const type = typeFromShape(m[1]);
    if (type) push({ start: m.index, end: m.index + m[0].length, form: 'tana', type, id: m[1] });
  }
  const tanaTyped = new RegExp(`(?<![\\w#])#(${TYPED.join('|')})[: ]([A-Za-z0-9._/-]+)`, 'gi');
  for (const m of text.matchAll(tanaTyped)) {
    let id = m[2];
    while (id && TRAIL.includes(id[id.length - 1])) id = id.slice(0, -1);
    push({ start: m.index, end: m.index + m[1].length + 2 + id.length, form: 'tana', type: m[1].toLowerCase(), id });
  }

  // 4. По виду: задача, спринт, семейства. Граница слова слева и справа.
  for (let i = 0; i < text.length; i++) {
    if (isIdChar(text[i - 1])) continue;
    let best = null;
    for (const [re, type] of [[TASK_RE, 'task'], [SPRINT_RE, 'sprint'], ...FAMILIES.map((f) => [f.re, f.type])]) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (!m) continue;
      let id = m[0];
      while (id && TRAIL.includes(id[id.length - 1])) id = id.slice(0, -1);
      if (/[A-Za-z0-9_]/.test(text[i + id.length] ?? '')) continue; // не граница справа
      if (!best || id.length > best.id.length) best = { id, type };
    }
    if (best) { push({ start: i, end: i + best.id.length, form: 'shape', type: best.type, id: best.id }); i += best.id.length - 1; }
  }

  // 5. Одинокий код задачи: токен, совпадающий с кодом существующей задачи, не в паре со спринтом.
  if (ctx?.taskCodes?.size) {
    for (const m of text.matchAll(/(?<![\w/.#@:-])([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)(?![\w/-])/g)) {
      if (!ctx.taskCodes.has(m[1])) continue;
      if (typeFromShape(m[1])) continue;
      push({ start: m.index, end: m.index + m[1].length, form: 'lone', type: 'task', id: m[1] });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Есть ли объект. Возвращает true/false, либо null — «проверить нечем» (тип не знаем). */
export function exists(type, id, ids) {
  const set = ids?.[type];
  if (!set) return null;
  if (set.has(id)) return true;
  if (type === 'release') return ids.release.has(id.replace(/^.*#/, '')) || false;
  return false;
}

/** Тип, под которым ID на самом деле есть (кроме уже проверенного), или null. Порядок — TYPED. */
export function typeOfId(id, ids, except) {
  for (const t of TYPED) if (t !== except && ids?.[t]?.has(id)) return t;
  return null;
}

/**
 * Классификация одного MD-тела.
 * @returns [{cls, type, id, broken, ambiguity, sameSprint, snippet}]
 */
export function classify(md, ctx = {}) {
  const out = [];
  if (!md || typeof md !== 'string') return out;
  for (const seg of segments(md)) {
    const hits = scanRefs(seg.text, ctx);
    for (const h of hits) {
      if (h.form === 'url_other') continue;
      let cls;
      if (seg.kind === 'fence') {
        if (h.form.startsWith('url_')) continue;
        cls = 'codeblock';
      } else if (seg.kind === 'inline') {
        if (h.form.startsWith('url_')) cls = h.form;
        else cls = 'backtick';
        if (h.form === 'lone') { h.lone = true; h.type = null; }
      } else if (h.form === 'wiki') {
        if (h.typedIn && !h.type) cls = 'wiki_unknown';
        else if (!h.typedIn && !h.type) cls = ctx.taskCodes?.has(h.id) ? 'lone_task_wiki' : (ctx.anyId?.(h.id) ? 'wiki_bare' : 'wiki_unknown');
        else cls = h.typedIn ? 'wiki_typed' : 'wiki_bare';
      } else if (h.form === 'lone') cls = 'lone_task';
      else cls = h.form; // typed | tana | shape | wiki_escaped | url_*
      const r = { cls, type: h.type, id: h.id };
      if (h.rawType) r.rawType = h.rawType;
      if (h.lone) r.lone = true;
      if (h.label) r.label = h.label;
      // Битость — для всех форм с известным типом (в т.ч. в кавычках: читатель всё равно ищет запись).
      if (h.type && !cls.startsWith('url_') && cls !== 'lone_task' && cls !== 'lone_task_wiki' && cls !== 'codeblock') {
        const ex = exists(h.type, h.id, ctx.ids);
        // Явная ссылка (wiki/тип/tana) на несуществующее — битая; голый ID по виду без записи —
        // «похоже на ID, записи нет» (часто локальная нумерация вроде UC-1 или шаблон SPRINT_X/CODE).
        // ID есть, но у другого типа (280 решений названы ADR-…-Dn): не битая, а вид назвал не тот тип.
        const other = ex === false ? typeOfId(h.id, ctx.ids, h.type) : null;
        if (other) r.wrongType = other;
        else if (ex === false) r.broken = ['wiki_typed', 'wiki_bare', 'typed', 'tana'].includes(cls) ? 'explicit' : 'shape';
      }
      if ((cls === 'lone_task' || cls === 'lone_task_wiki') && ctx.taskCodes) {
        r.ambiguity = ctx.taskCodes.get(h.id) ?? 0;
        if (ctx.ownerSprint && ctx.ids?.task?.has(`${ctx.ownerSprint}/${h.id}`)) r.sameSprint = true;
      }
      const s = Math.max(0, h.start - 40); const e = Math.min(seg.text.length, h.end + 40);
      r.snippet = (seg.kind === 'inline' ? '`' : '') + seg.text.slice(s, e).replace(/\s+/g, ' ').trim() + (seg.kind === 'inline' ? '`' : '');
      out.push(r);
    }
  }
  return out;
}
