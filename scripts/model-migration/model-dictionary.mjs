#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MD-01 · Словарь типов, полей и связей LORE: назначение, кто пишет, кто читает, паспорт.
// Генерируется из модели 1.18 (shared/model/lore-model.json), карты переноса (map/*.json), переписи связей прода
// (tools/census/edge-triples.tsv) и текста кода (backend/src/main, mcp-server/src) — не пишется руками, чтобы его
// можно было переснять. Правило владелицы: документация моделей живёт в LORE, поэтому выход — страницы Markdown для
// MCP doc_new (kind reference, проект NooriUta/UnlimitedLORE), а не md в репозитории.
//
// Запуск: node scripts/model-migration/model-dictionary.mjs --out <папка>
//   → <папка>/<doc_id>.md на каждую страницу и manifest.json [{doc_id, title, parent, sort_order, file}].
// Затем каждую страницу — doc_new(doc_id, title, kind:"reference", content_md_ru, parent_doc_id, sort_order).
//
// Метки происхождения в тексте: «модель» — lore-model.json; «карта» — карта переноса 1.18; «перепись» — снимок прода;
// «код» — поиск по тексту кода (имя в строке SQL). Поиск по тексту не видит имён, собранных склейкой строк, поэтому
// «в коде прямым текстом не найдено» — это «не нашли», а не «никто не пишет».
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const NAME_RE = n => new RegExp(`(?<![A-Za-z0-9_])${n}(?![A-Za-z0-9_])`);
const WRITE_RE = n => new RegExp(`(CREATE\\s+EDGE|INSERT\\s+INTO|UPDATE|UPSERT\\s+INTO|CREATE\\s+VERTEX|DELETE\\s+FROM|DELETE\\s+VERTEX|DELETE\\s+EDGE)\\s+\`?${n}(?![A-Za-z0-9_])`, 'i');
const SCHEMA_RE = n => new RegExp(`(CREATE\\s+(EDGE|VERTEX|DOCUMENT)\\s+TYPE\\s+\`?${n}(?![A-Za-z0-9_])|CREATE\\s+PROPERTY\\s+${n}\\.|ALTER\\s+TYPE\\s+${n}(?![A-Za-z0-9_])|DROP\\s+TYPE\\s+${n}(?![A-Za-z0-9_]))`, 'i');

/** Что делает строка кода с именем типа/связи: write · schema · read; null — имени в строке нет. */
export function classifyLine(line, name) {
  if (!NAME_RE(name).test(line)) return null;
  if (SCHEMA_RE(name).test(line)) return 'schema';
  if (WRITE_RE(name).test(line)) return 'write';
  return 'read';
}

/** Индекс кода: files = [{path, text}] → функция (имя) → {writers, readers} — базовые имена файлов, по алфавиту. */
export function scanCode(files) {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const cache = new Map();
  return name => {
    if (cache.has(name)) return cache.get(name);
    const w = new Set(), r = new Set();
    for (const f of sorted) {
      if (!f.text.includes(name)) continue;
      for (const line of f.text.split('\n')) {
        const c = classifyLine(line, name);
        if (c === 'write') w.add(path.basename(f.path));
        else if (c === 'read') r.add(path.basename(f.path));
      }
    }
    const out = { writers: [...w].sort(), readers: [...r].filter(x => !w.has(x)).sort() };
    cache.set(name, out);
    return out;
  };
}

const NOT_FOUND = 'в коде прямым текстом не найдено';
const list = (xs, max = 6) => !xs || !xs.length ? NOT_FOUND : xs.slice(0, max).join(', ') + (xs.length > max ? ` и ещё ${xs.length - max}` : '');
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
const NO_PURPOSE = '— не записано в модели';

function edgePurpose(name, model, edgesMap) {
  const h = model.edge_history && model.edge_history.edges && model.edge_history.edges[name];
  if (h) return h + ' (модель)';
  const r = edgesMap.edges[name];
  const shape = r && r.shape;
  if (shape) {
    const kind = edgesMap._vocab && edgesMap._vocab.kind && edgesMap._vocab.kind[shape.kind];
    return `${shape.meaning}${kind ? '; ' + kind : ''} (карта)`;
  }
  return NO_PURPOSE;
}

function transferOf(rule) {
  if (!rule) return 'нет правила в карте';
  const head = rule.rule + (rule.to ? ` → ${rule.to}${rule.reverse ? ' (разворот)' : ''}` : '');
  return `${head} · ${rule.basis || '—'}${rule.note ? ' · ' + rule.note : ''}`;
}

/** Где поле показано в паспорте типа. */
function placeOf(t, f, isBody) {
  if (isBody) return 'тело паспорта';
  const sec = (t.props || []).find(p => (p.fields || []).includes(f.key));
  if (sec) return 'свойства' + (sec.section ? ` · ${sec.section}` : '');
  if (f.group === 'head') return 'шапка';
  if (f.group) return f.group;
  return 'не показывается в паспорте';
}

function writerOf(f, createFields) {
  const out = [];
  if (f.write && f.write.endpoint) out.push(`${f.write.endpoint}${f.write.field ? ` (${f.write.field})` : ''}`);
  if (createFields && createFields.has(f.key)) out.push(`создание: ${createFields.get(f.key)}`);
  if (f.rel) out.push(`связь ${f.rel}${f.dir ? ` (${f.dir})` : ''}`);
  return out.length ? out.join('; ') : 'из паспорта не правится';
}

function readerOf(t, f, model) {
  const out = ['паспорт /lore/record'];
  if (f.historic) out.push('история версий');
  if (f.dict) out.push(`справочник ${f.dict}`);
  // столбцы частей других типов — срезы, которые показывают это поле
  for (const o of model.types) for (const p of o.parts || []) if (p.type === t.type && (p.columns || []).concat(p.optionalColumns || []).includes(f.key) && p.slice) out.push(`срез ${p.slice}`);
  return [...new Set(out)].join('; ');
}

/**
 * Словарь целиком. model — lore-model.json; edgesMap — map/all.edges.json; objectsMap — map/all-objects.json;
 * triples — [[связь, из, в, n]] переписи; code — scanCode(...); source — строка «откуда снято».
 */
export function buildDictionary({ model, edgesMap, objectsMap, triples, code, source }) {
  const graphOf = type => (model.graph && model.graph[type]) || {};
  const types = [];
  const passportTypes = [...model.types.map(t => [t, false]), ...model.child_only.map(t => [t, true])];
  for (const [t, childOnly] of passportTypes) {
    const g = graphOf(t.type);
    const createFields = new Map(((model.create && model.create[t.type] && model.create[t.type].fields) || []).map(c => [c.key, model.create[t.type].endpoint]));
    const fields = [];
    const seen = new Set();
    for (const [arr, isBody] of [[t.fields || [], false], [t.body || [], true]]) {
      for (const f of arr) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        fields.push({
          key: f.key,
          label: f.label,
          kind: f.kind || (isBody ? 'md' : ''),
          layer: f.layer || '',
          purpose: f.definition ? f.definition : NO_PURPOSE,
          writer: writerOf(f, createFields),
          reader: readerOf(t, f, model),
          passport: placeOf(t, f, isBody),
        });
      }
    }
    const c = g.vertex ? code(g.vertex) : { writers: [], readers: [] };
    types.push({
      type: t.type, label: t.label, childOnly, vertex: g.vertex || '', hist: g.hist || '', key: g.key || '',
      history: (model.time && model.time[t.type] && model.time[t.type].history) || '',
      audience: (model.audience && model.audience[t.type]) || '',
      readOnly: (model.read_only || []).includes(t.type),
      blocks: ((model.passport && model.passport[t.type]) || []).map(b => b.key),
      transfer: transferOfType(g.vertex, objectsMap),
      writers: c.writers, readers: c.readers, fields,
    });
  }

  // Связи: карта переноса ∪ связи, которые показывает модель.
  const shown = new Map();
  for (const t of [...model.types, ...model.child_only]) {
    const add = (rel, how) => { if (!rel) return; (shown.get(rel) || shown.set(rel, []).get(rel)).push(`${t.type}: ${how}`); };
    for (const r of t.relations || []) add(r.rel, `${r.label} (${r.dir}, ${r.place || 'link_tab'})`);
    for (const p of t.parts || []) add(p.rel, `часть «${p.label}» (${p.dir})`);
    for (const tab of t.linkTabs || []) for (const r of tab.rels || []) add(r.rel, `вкладка «${tab.label}» · ${r.label} (${r.dir})`);
    for (const f of t.fields || []) if (f.rel) add(f.rel, `поле «${f.label}» (${f.dir || 'out'})`);
  }
  const names = [...new Set([...Object.keys(edgesMap.edges), ...shown.keys()])].sort();
  const edges = names.map(name => {
    const c = code(name);
    return {
      name,
      purpose: edgePurpose(name, model, edgesMap),
      ends: triples.filter(x => x[0] === name).map(x => `${x[1]} → ${x[2]} (${x[3]})`).sort(),
      passport: [...new Set(shown.get(name) || [])].sort(),
      writers: c.writers, readers: c.readers,
      transfer: transferOf(edgesMap.edges[name]),
      historic: !!(model.edge_history && model.edge_history.edges && model.edge_history.edges[name]),
    };
  });

  // Типы вне паспорта: всё, что знает карта переноса, но не модель паспорта.
  const inPassport = new Set(types.flatMap(t => [t.vertex, t.hist]).filter(Boolean));
  const otherNames = [...new Set([...Object.keys(objectsMap.types), ...Object.keys(objectsMap.skipped)])].filter(T => !inPassport.has(T)).sort();
  const others = otherNames.map(T => {
    const c = code(T);
    const fieldsOf = objectsMap.types[T] ? Object.keys(objectsMap.types[T]) : [];
    return {
      vertex: T, fields: fieldsOf,
      transfer: objectsMap.types[T] ? 'переносится по карте' : 'не переносится: ' + objectsMap.skipped[T],
      writers: c.writers, readers: c.readers,
    };
  });

  return { types, edges, others, pages: renderPages({ types, edges, others, source, model }) };
}

const FIRST = new Set(['KnowSprint', 'KnowPhase', 'KnowTask']);
/** Судьба типа при переносе по карте 1.18. */
export function transferOfType(T, objectsMap) {
  if (!T) return '—';
  if (objectsMap.types[T]) return 'переносится по карте';
  if (objectsMap.skipped[T]) return 'не переносится: ' + objectsMap.skipped[T];
  if (FIRST.has(T)) return 'первый объект — своей картой (sprint-phase-task)';
  return 'в карте переноса нет: тип новой модели, данных в источнике нет';
}

const ROOT = 'lore_model_dictionary';
const LEGEND = `Метки происхождения: **модель** — \`shared/model/lore-model.json\`; **карта** — карта переноса 1.18 (\`scripts/model-migration/map\`); **перепись** — снимок связей прода (\`tools/census/edge-triples.tsv\`); **код** — поиск имени в строках SQL кода (\`backend/src/main\`, \`mcp-server/src\`). Поиск по тексту не видит имён, собранных склейкой строк: «${NOT_FOUND}» значит «не нашли», а не «никто не пишет». «${NO_PURPOSE}» — у поля нет определения в модели; назначение не выдумано.`;

function renderPages({ types, edges, others, source }) {
  const pages = [];
  const regen = 'Пересъёмка: `node scripts/model-migration/model-dictionary.mjs --out <папка>`, затем каждую страницу из `manifest.json` — MCP `doc_new` (kind `reference`).';
  // 1. обзор
  let md = `# Словарь модели LORE 1.18: типы, поля, связи\n\nSPRINT_LORE_MODEL_DOCS_TIDY/MD-01. Сгенерировано из модели и кода, руками не правится. Источник: ${source}.\n\n${regen}\n\n${LEGEND}\n\n`;
  md += `## Типы паспорта (модель)\n\n| тип | подпись | вершина · версии · ключ | история | кому видно | поля | кто пишет (код) | кто читает (код) | перенос (карта) |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const t of types) md += `| ${t.type}${t.childOnly ? ' (часть)' : ''} | ${cell(t.label)} | ${cell([t.vertex, t.hist, t.key].filter(Boolean).join(' · ') || '—')} | ${t.history || '—'} | ${t.audience || '—'}${t.readOnly ? ', только чтение' : ''} | ${t.fields.length} | ${cell(list(t.writers, 4))} | ${cell(list(t.readers, 4))} | ${cell(t.transfer || '—')} |\n`;
  md += `\nСтраницы: поля по типам — «${ROOT}_fields_N», связи — «${ROOT}_edges», типы вне паспорта — «${ROOT}_other_types».\n`;
  pages.push({ doc_id: ROOT, title: 'Словарь модели LORE 1.18: типы, поля, связи', md });

  // 2. поля — порциями до ~80 КБ
  const chunks = [];
  let cur = '';
  for (const t of types) {
    let s = `## ${t.type}${t.childOnly ? ' (часть паспорта)' : ''} — ${cell(t.label)}\n\n`;
    s += `Вершина: ${t.vertex || '—'}${t.hist ? ` · версии: ${t.hist}` : ''}${t.key ? ` · ключ: ${t.key}` : ''}. Блоки паспорта (модель): ${t.blocks.length ? t.blocks.join(', ') : '—'}.\n\n`;
    s += `| поле | подпись | вид · слой | назначение (модель) | кто пишет (модель) | кто читает (модель) | паспорт (модель) |\n|---|---|---|---|---|---|---|\n`;
    for (const f of t.fields) s += `| ${f.key} | ${cell(f.label)} | ${cell([f.kind, f.layer].filter(Boolean).join(' · ') || '—')} | ${cell(f.purpose)} | ${cell(f.writer)} | ${cell(f.reader)} | ${cell(f.passport)} |\n`;
    s += '\n';
    if (cur && Buffer.byteLength(cur + s) > 80000) { chunks.push(cur); cur = ''; }
    cur += s;
  }
  if (cur) chunks.push(cur);
  chunks.forEach((body, i) => {
    const first = (body.match(/^## (\S+)/m) || [])[1], last = [...body.matchAll(/^## (\S+)/gm)].pop()[1];
    pages.push({ doc_id: `${ROOT}_fields_${i + 1}`, title: `Словарь модели: поля — ${first} … ${last}`, md: `# Поля типов паспорта: ${first} … ${last}\n\n${LEGEND}\n\n${body}` });
  });

  // 3. связи
  let e = `# Словарь модели: связи\n\n${LEGEND}\n\n| связь | назначение | концы и число в проде (перепись) | паспорт (модель) | кто пишет (код) | кто читает (код) | перенос (карта) |\n|---|---|---|---|---|---|---|\n`;
  for (const x of edges) e += `| ${x.name}${x.historic ? ' (с историей)' : ''} | ${cell(x.purpose)} | ${cell(x.ends.join('; ') || 'в переписи нет')} | ${cell(x.passport.join('; ') || 'не показывается')} | ${cell(list(x.writers))} | ${cell(list(x.readers))} | ${cell(x.transfer)} |\n`;
  pages.push({ doc_id: `${ROOT}_edges`, title: 'Словарь модели: связи', md: e });

  // 4. типы вне паспорта
  let o = `# Словарь модели: типы вне паспорта\n\nТипы базы, которых нет среди типов паспорта модели: служебные, рутины и гейты качества, BRAGI, личные настройки, снятые. Назначение у них в модели не записано — ниже только факты карты и кода.\n\n${LEGEND}\n\n| тип | полей в карте | кто пишет (код) | кто читает (код) | перенос (карта) |\n|---|---|---|---|---|\n`;
  for (const x of others) o += `| ${x.vertex} | ${x.fields.length} | ${cell(list(x.writers))} | ${cell(list(x.readers))} | ${cell(x.transfer)} |\n`;
  pages.push({ doc_id: `${ROOT}_other_types`, title: 'Словарь модели: типы вне паспорта', md: o });

  return pages.map((p, i) => ({ ...p, parent: i === 0 ? '' : ROOT, sort_order: i }));
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('model-dictionary.mjs')) {
  const outIx = process.argv.indexOf('--out');
  if (outIx < 0) { console.error('нужно --out <папка>'); process.exit(2); }
  const out = process.argv[outIx + 1];
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const repo = path.resolve(here, '..', '..');
  const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
  const modelText = read('shared/model/lore-model.json');
  const model = JSON.parse(modelText);
  const edgesMap = JSON.parse(read('scripts/model-migration/map/all.edges.json'));
  const objectsMap = JSON.parse(read('scripts/model-migration/map/all-objects.json'));
  const triples = read('scripts/model-migration/tools/census/edge-triples.tsv').trim().split(/\r?\n/).map(l => l.split('\t'));
  const tracked = execFileSync('git', ['-C', repo, 'ls-files', 'backend/src/main', 'mcp-server/src'], { encoding: 'utf8' }).split('\n')
    .filter(p => /\.(java|ts|mjs|js)$/.test(p) && !/\.test\.|Test\.java$/.test(p));
  const files = tracked.map(p => ({ path: p, text: read(p) }));
  const hash = crypto.createHash('sha256').update(modelText).digest('hex').slice(0, 12);
  const d = buildDictionary({ model, edgesMap, objectsMap, triples, code: scanCode(files), source: `модель \`lore-model.json\` sha256 ${hash}, ${files.length} файлов кода` });
  fs.mkdirSync(out, { recursive: true });
  const manifest = d.pages.map(p => { const file = p.doc_id + '.md'; fs.writeFileSync(path.join(out, file), p.md); return { doc_id: p.doc_id, title: p.title, parent: p.parent, sort_order: p.sort_order, file, bytes: Buffer.byteLength(p.md) }; });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`словарь: типов паспорта ${d.types.length}, полей ${d.types.reduce((a, t) => a + t.fields.length, 0)}, связей ${d.edges.length}, типов вне паспорта ${d.others.length}; страниц ${d.pages.length} → ${out}`);
}
