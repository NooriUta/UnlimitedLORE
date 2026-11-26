#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MD-03 · Спека схемы LORE_DB_SCHEMA_MERMAID: типы, вершины, ключи, история и связи
// модели 1.18 — схемами Mermaid (раскладка ELK) по областям. Генерируется из shared/model/lore-model.json и карты
// переноса (map/*.json), а не пишется руками, чтобы переснимать после правок модели. Поля и назначение связей здесь
// не повторяются — они в словаре MD-01 (model-dictionary.mjs → доки lore_model_dictionary*).
//
// Запуск: node scripts/model-migration/schema-spec.mjs --out <папка>
//   → <папка>/LORE_DB_SCHEMA_MERMAID.md — тело спеки для MCP entity_upsert type=spec (id LORE_DB_SCHEMA_MERMAID).
// Замещённые спеки: supersededBody({was, by, why}) — шапка «Замещена» над прежним текстом (идемпотентно).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA_SPEC_ID = 'LORE_DB_SCHEMA_MERMAID';
const DICT = 'lore_model_dictionary';

/** Области схемы. Первые четыре — группы навигации модели (model.nav), «люди» — типы вне навигации. */
export const AREAS = [
  { id: 'work', nav: 'work', title: 'Работа' },
  { id: 'knowledge', nav: 'knowledge', title: 'Решения и знания' },
  { id: 'product', nav: 'product', title: 'Продукт' },
  { id: 'system', nav: 'system', title: 'Проекты и система' },
  // #1694 (PS-PRODUCT-FILTER): группа меню «Организация» — организации, продукты, проекты, люди.
  { id: 'org', nav: 'org', title: 'Организация' },
  { id: 'people', nav: null, title: 'Люди и агенты' },
];
// Типы, которых нет в model.nav: часть паспорта и админские. Новый тип без места здесь и в nav валит тест.
// qg_metric — часть паспорта гейта (20.11.2026), область гейта — «Работа».
// pr — паспорт без раздела-списка (MD-05), открывается в «Релизах»: область «Работа».
// machine — паспорт машины только в админке (AP-MACHINE-PASSPORT, 25.11.2026): рядом с людьми и агентами.
// KREG-13 (26.11.2026): скилл и сессия агента — рядом с людьми и агентами; супертег и вид реестра — «Проекты и система».
const EXTRA_AREA = { phase: 'work', qg_metric: 'work', track: 'work', pr: 'work', user: 'people', agent: 'people', machine: 'people',
  skill: 'people', agent_session: 'people', tag: 'system', kind: 'system' };

/** Область типа модели: группа навигации либо EXTRA_AREA; null — места нет. */
export function areaOf(type, model) {
  for (const a of AREAS) {
    if (!a.nav) continue;
    const g = (model.nav || []).find(n => n.id === a.nav);
    if (g && g.items.some(i => i.section === type)) return a.id;
  }
  return EXTRA_AREA[type] || null;
}

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
const ARROW = { composition: '==>', aggregation: '==>', realization: '-.->' };
const arrowOf = kind => ARROW[kind] || '-->';

/** Связи модели между конкретными типами: [{from, rel, to, kind}] без «any» и HAS_STATE→hist, по одной на тройку. */
export function modelEdges(model) {
  const seen = new Map();
  for (const t of [...model.types, ...model.child_only]) for (const r of t.relations || []) {
    if (!r.targetType || r.targetType === 'any' || r.targetType === 'hist') continue;
    const [from, to] = r.dir === 'in' ? [r.targetType, t.type] : [t.type, r.targetType];
    const k = `${from}|${r.rel}|${to}`;
    const prev = seen.get(k);
    // одна тройка может прийти с двух сторон с разным видом — сильнейший вид побеждает
    const rank = x => ({ composition: 4, aggregation: 3, realization: 2, association: 1, attribute: 0 })[x] ?? 0;
    if (!prev || rank(r.relation) > rank(prev.kind)) seen.set(k, { from, rel: r.rel, to, kind: r.relation || '' });
  }
  return [...seen.values()].sort((a, b) => `${a.from}|${a.rel}|${a.to}`.localeCompare(`${b.from}|${b.rel}|${b.to}`));
}

function typeInfo(model) {
  const info = new Map();
  for (const t of [...model.types, ...model.child_only]) {
    if (info.has(t.type)) continue;
    const g = (model.graph && model.graph[t.type]) || {};
    const history = (model.time && model.time[t.type] && model.time[t.type].history) || (g.hist ? 'scd2' : 'none');
    info.set(t.type, { type: t.type, label: t.label, vertex: g.vertex || '', hist: g.hist || '', key: g.key || '', history, childOnly: !model.types.includes(t) });
  }
  return info;
}

function nodeLine(id, info, external) {
  const t = info.get(id);
  if (!t) return `    ${id}["${id}<br/><i>вне паспорта</i>"]:::ext`;
  const sub = [t.vertex, t.history === 'scd2' ? 'SCD2' : ''].filter(Boolean).join(' · ');
  return `    ${id}["${t.label}<br/>${sub || id}"]${external ? ':::ext' : ''}`;
}

export const FAN_MIN = 6;
/** Веер: связь в одну цель из FAN_MIN и более типов → Map("REL|to" → [from…]). Стрелками не рисуется — забивает схему. */
export function fans(edges) {
  const by = new Map();
  for (const e of edges) { const k = e.rel + "|" + e.to; by.set(k, [...(by.get(k) || []), e.from]); }
  return new Map([...by].filter(([, fs]) => new Set(fs).size >= FAN_MIN).sort(([a], [b]) => a.localeCompare(b)));
}

function diagram(area, model, edges, info, fan) {
  const own = new Set([...info.keys()].filter(T => areaOf(T, model) === area.id));
  // Связь-признак (attribute) через границу области рисуется только в области своей цели, если цель — тип модели:
  // иначе BELONGS_TO_PROJECT / BELONGS_TO тянулись бы на каждую схему и забивали её.
  const es = edges.filter(e => {
    if (fan.has(e.rel + "|" + e.to)) return false;
    if (own.has(e.from) && own.has(e.to)) return true;
    if (!own.has(e.from) && !own.has(e.to)) return false;
    return !(e.kind === "attribute" && own.has(e.from) && areaOf(e.to, model));
  });
  const ext = new Set(es.flatMap(e => [e.from, e.to]).filter(x => !own.has(x)));
  const lines = ['---', 'config:', '  layout: elk', '  flowchart:', '    useMaxWidth: false', '---', 'flowchart TB'];
  for (const T of [...own].sort()) lines.push(nodeLine(T, info, false));
  for (const T of [...ext].sort()) lines.push(nodeLine(T, info, true));
  for (const e of es) lines.push(`    ${e.from} ${arrowOf(e.kind)}|${e.rel}| ${e.to}`);
  lines.push('    classDef ext stroke-dasharray: 4 3,opacity:0.75');
  return { own, ext, edges: es, text: lines.join('\n') + '\n' };
}

/** Тело спеки LORE_DB_SCHEMA_MERMAID. */
export function buildSchemaSpec({ model, edgesMap, objectsMap, source }) {
  const info = typeInfo(model);
  const edges = modelEdges(model);
  const regen = 'Пересъёмка: `node scripts/model-migration/schema-spec.mjs --out <папка>`, затем MCP `entity_upsert type=spec id=LORE_DB_SCHEMA_MERMAID` с телом из файла.';
  let md = `# Схема базы LORE по модели 1.18: типы и связи\n\n`;
  md += `SPRINT_LORE_MODEL_DOCS_TIDY/MD-03. Сгенерировано из модели, руками не правится. Источник: ${source}.\n\n${regen}\n\n`;
  md += `**Где что.** Эта спека — карта: какие типы есть, в какой вершине базы живут, по какому ключу ищутся, ведут ли историю версий (SCD2) и как связаны. `;
  md += `Поля типов, назначение каждой связи, кто её пишет и читает в коде, число связей в проде — в словаре модели [[${DICT}]]: поля — [[${DICT}_fields_1]] и следующие страницы, связи — [[${DICT}_edges]], типы базы вне паспорта (служебные, рутины, гейты, BRAGI) — [[${DICT}_other_types]].\n\n`;
  md += `**Источник истины — модель** \`shared/model/lore-model.json\` (ADR-LORE-048). \`backend/db-schema/create-schema.sql\` и \`schema-metadata.json\` — снимки для разворота с нуля, модель по ним не сверяется; где расходятся с моделью — права модель.\n\n`;
  md += `**Как читать схемы.** Сплошная толстая стрелка — состав или агрегация (часть живёт внутри целого), пунктирная — реализация (задача реализует сценарий, PR закрывает задачу), тонкая — ассоциация или признак. Пунктирная рамка — тип другой области или тип вне паспорта. Подпись узла: название типа · вершина базы · SCD2, если тип ведёт историю версий (ребро HAS_STATE к строке версий). `;
  md += `Не нарисованы: REFERENCES (упоминание из текста, любой тип → любой), HAS_STATE (у каждого типа с пометкой SCD2) и связи с «любым» концом.\n\n`;

  const fan = fans(edges);
  md += `**Веерные связи** — одна связь в одну цель из ${FAN_MIN} и более типов; стрелками не рисуются, чтобы не забивать схемы:\n\n`;
  for (const [k, froms] of fan) { const [rel, to] = k.split('|'); md += `- **${rel} → ${to}** (${froms.length}): ${[...froms].sort().join(', ')}\n`; }
  md += '\n';

  for (const a of AREAS) {
    const d = diagram(a, model, edges, info, fan);
    md += `## ${a.title}\n\nТипы: ${[...d.own].sort().map(T => `${info.get(T).label} (${T})`).join(', ')}. Связей на схеме: ${d.edges.length}.\n\n\`\`\`mermaid\n${d.text}\`\`\`\n\n`;
  }

  md += `## Типы паспорта\n\n| тип | подпись | область | вершина | версии | ключ | история |\n|---|---|---|---|---|---|---|\n`;
  for (const t of info.values()) {
    const area = AREAS.find(a => a.id === areaOf(t.type, model));
    md += `| ${t.type}${t.childOnly ? ' (часть)' : ''} | ${cell(t.label)} | ${area ? area.title : '—'} | ${t.vertex || '—'} | ${t.hist || '—'} | ${t.key || '—'} | ${t.history} |\n`;
  }
  const byVertex = new Map();
  for (const t of info.values()) if (t.vertex) byVertex.set(t.vertex, [...(byVertex.get(t.vertex) || []), t.type]);
  const shared = [...byVertex].filter(([, ts]) => ts.length > 1);
  md += shared.length ? `\nОдна вершина на несколько типов (различаются видом записи): ${shared.map(([v, ts]) => `${v} — ${ts.join(', ')}`).join('; ')}.\n\n` : '\n';

  md += `## Связи модели\n\n| связь | из | в | вид |\n|---|---|---|---|\n`;
  for (const e of edges) md += `| ${e.rel} | ${e.from} | ${e.to} | ${e.kind || '—'} |\n`;
  md += `\nНазначение каждой связи и где её пишет код — [[${DICT}_edges]].\n\n`;

  md += `## Снято в 1.18 (карта переноса)\n\nЭти имена в базу новой модели не переносятся; спеки и доки, которые их называют, описывают прежнюю схему.\n\n| тип | причина |\n|---|---|\n`;
  for (const [T, why] of Object.entries(objectsMap.skipped).sort()) md += `| ${T} | ${cell(why)} |\n`;
  md += `\n| связь | причина |\n|---|---|\n`;
  for (const [E, r] of Object.entries(edgesMap.edges).sort()) if (r.rule === 'drop') md += `| ${E} | ${cell(r.note || r.basis || '—')} |\n`;
  md += `\nСняты раньше 1.18 и в карте уже не встречаются: пласт PlanItem (PlanItem, PlanItemHist, StatusPlanItem; связи CONTRIBUTES_TO, ON_TRACK, REPRESENTS — миграции V54/V57), LoreTag (схлопнут в KnowTag, V17), KnowFeature (слит в KnowUseCase, V13).\n`;
  return { md, edges, info };
}

const BANNER_RE = /^> \*\*Замещена[\s\S]*?\n\n---\n\n/;
/** Тело замещённой спеки: шапка со ссылками на замену и причиной, ниже прежний текст. Повторный вызов шапку не наращивает. */
export function supersededBody({ was, by, why }) {
  const old = String(was || '').replace(BANNER_RE, '');
  if (BANNER_RE.test(String(was || ''))) return was;
  const links = by.map(x => `[[${x}]]`).join(', ');
  return `> **Замещена** (SPRINT_LORE_MODEL_DOCS_TIDY/MD-03). Актуальное описание схемы — ${links}, генерируется из модели 1.18 \`shared/model/lore-model.json\`.\n> Причина: ${why}\n> Текст ниже — прежняя редакция, сохранён для истории; где расходится с моделью — права модель.\n\n---\n\n${old}`;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('schema-spec.mjs')) {
  const outIx = process.argv.indexOf('--out');
  if (outIx < 0) { console.error('нужно --out <папка>'); process.exit(2); }
  const out = process.argv[outIx + 1];
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const repo = path.resolve(here, '..', '..');
  const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
  const modelText = read('shared/model/lore-model.json');
  const hash = crypto.createHash('sha256').update(modelText).digest('hex').slice(0, 12);
  const s = buildSchemaSpec({
    model: JSON.parse(modelText),
    edgesMap: JSON.parse(read('scripts/model-migration/map/all.edges.json')),
    objectsMap: JSON.parse(read('scripts/model-migration/map/all-objects.json')),
    source: `модель \`lore-model.json\` sha256 ${hash}`,
  });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, SCHEMA_SPEC_ID + '.md'), s.md);
  console.log(`спека схемы: типов ${s.info.size}, связей ${s.edges.length}, блоков mermaid ${AREAS.length}, ${Buffer.byteLength(s.md)} байт → ${out}`);
}
