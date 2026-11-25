#!/usr/bin/env node
// SPRINT_LORE_KNOW_REGISTRY/KREG-08 — выгрузка несогласованностей модели LORE в JSON.
// Вход для KREG-02/KREG-10 (чистка модели).
//
// Что смотрит (по категориям факта 24.11.2026):
//   1. fieldsWithoutLabelKey   — поля без ключа локализации (labelKey — общий ключ веба и телефона, MDL-09);
//   2. modelSchemaEdgesNotInModel — рёбра из MODEL_SCHEMA_EDGES (LoreModelConsistency.java: «схема из модели» —
//                              ANSWERABLE_BY, ON_TRACK, ORG_*, HAS_REPOSITORY …), на которые модель не
//                              ссылается ни одной связью — связь объявлена в коде, а паспорт её не описывает;
//   3. listTypes               — list-типы (organization, pr, repository, track): есть ли определение типа,
//                              графа, паспорта; не висят ли связи в пустоту (target-типа нет в модели);
//   4. unclassified            — [нужен дамп схемы] свойства вершин схемы, которые модель не описывает
//                              (видимость unclassified у LoreModelTypes);
//   5. writtenWithoutSchema    — [нужен дамп схемы] поля с путём записи, у которых целевое свойство
//                              в схеме вершины отсутствует (пишется-без-схемы; факт: adr.date).
//
// Запуск:
//   node scripts/model-inconsistencies.mjs [--model backend/src/main/resources/lore-model/lore-model.json]
//       [--schema schema-types-dump.json] [--out docs/reports/model-inconsistencies.json]
// Дамп схемы: SELECT name, type, properties FROM schema:types → JSON-массив (например, через
// /api/v1/query). Без --schema разделы 4–5 пустые, в summary.schema: "absent".
// Кодировка: и модель, и дамп — UTF-8.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

const modelPath = path.resolve(repo, arg('model', 'backend/src/main/resources/lore-model/lore-model.json'));
const schemaPath = arg('schema', null) ? path.resolve(repo, arg('schema', '')) : null;
const outPath = path.resolve(repo, arg('out', 'docs/reports/model-inconsistencies.json'));

const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const schemaRows = schemaPath ? JSON.parse(fs.readFileSync(schemaPath, 'utf8')) : null;

const graphTypes = Object.keys(model.graph || {});
const typeDefs = new Map((model.types || []).map(t => [t.type, t]));
const relationsOf = t => t.relations || [];
const linkTabsOf = t => t.linkTabs || [];

// 1. Поля без labelKey (fields + body + linkTabs).
const fieldsWithoutLabelKey = [];
for (const t of model.types || []) {
  const spots = [
    ['fields', t.fields || []],
    ['body', t.body || []],
    ['linkTabs', linkTabsOf(t)],
  ];
  for (const [where, list] of spots)
    for (const f of list)
      if (!f.labelKey)
        fieldsWithoutLabelKey.push({ type: t.type, field: f.key, where });
}

// 2. Рёбра «схема из модели» (код), на которые модель не ссылается ни одной связью.
const consistencySrc = fs.readFileSync(
  path.join(repo, 'backend/src/main/java/studio/seer/heimdall/lore/LoreModelConsistency.java'), 'utf8');
const edgesBlock = consistencySrc.slice(
  consistencySrc.indexOf('MODEL_SCHEMA_EDGES = Map.of('), consistencySrc.indexOf(');', consistencySrc.indexOf('MODEL_SCHEMA_EDGES = Map.of(')));
const codeEdges = [...edgesBlock.matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map(m => m[1]);
const referencedRels = new Set();
for (const t of model.types || [])
  for (const r of relationsOf(t)) if (r.rel) referencedRels.add(r.rel);
const modelSchemaEdgesNotInModel = [...new Set(codeEdges)]
  .filter(rel => !referencedRels.has(rel))
  .map(rel => ({ rel, referencedByModel: false }));

// 3. List-типы: определение есть везде или нет; связи не ведут в никуда.
const listTypeNames = ['organization', 'pr', 'repository', 'track'];
const listTypes = listTypeNames.map(name => {
  const issues = [];
  const def = typeDefs.get(name);
  if (!def) issues.push('нет определения типа (types[])');
  if (!(model.passport || {})[name]) issues.push('нет паспорта (passport)');
  if (!(model.graph || {})[name]) issues.push('нет записи в graph');
  for (const r of def ? relationsOf(def) : []) {
    const target = r.target_type || r.targetType;
    if (target && !graphTypes.includes(target)) issues.push(`связь ${r.key}: target-тип «${target}» вне модели`);
    if (r.rel && !referencedRels.has(r.rel)) issues.push(`связь ${r.key}: рёбра «${r.rel}» нет ни у одного типа модели`);
  }
  return { type: name, issues };
});

// 4–5. Разделы по схеме (нужен дамп schema:types).
const unclassified = [];
const writtenWithoutSchema = [];
let schemaStatus = 'absent';
if (schemaRows) {
  schemaStatus = 'provided';
  const vertices = new Map();
  for (const row of schemaRows) {
    if (!/vertex/i.test(String(row.type))) continue;
    const props = Array.isArray(row.properties) ? row.properties.map(p => p && p.name).filter(Boolean) : [];
    vertices.set(String(row.name), new Set(props));
  }
  // KREG-10 п.4 (владелец 25.11.2026, «4а»): правила — те же, что у сервера (LoreModelTypes.isSystem / isInternal).
  // Системное не уходит никуда; служебное — один список service_fields модели плюс правило *_uid (KREG-10 п.2).
  const isSystem = p => p.startsWith('@') || ['valid_to', 'state_uid', 'content_hash', 'secret_ref'].includes(p)
    || p.includes('embedding') || p.includes('vector');
  const service = new Set(Object.keys(model.service_fields || {}));
  const isService = (p, key) => p !== key && (service.has(p) || p.endsWith('_uid'));
  const aliases = model.aliases || {};
  const edgeFields = model.edge_fields || {};
  const legacyRoleStrings = new Set(model.legacy_role_strings || []);
  // write.field у связи — имя РЕБРА, а не свойства (BELONGS_TO, TAGGED_WITH…): это не «без схемы».
  const edgeNames = new Set();
  for (const t of model.types || [])
    for (const r of relationsOf(t)) if (r.rel) edgeNames.add(r.rel);
  for (const t of model.types || []) {
    const g = (model.graph || {})[t.type];
    if (!g || !vertices.has(g.vertex)) continue;
    const props = vertices.get(g.vertex);
    // Поле с историей живёт в версии записи (*Hist): искать его надо и там, а не только на вершине.
    const histProps = g.hist && vertices.has(g.hist) ? vertices.get(g.hist) : new Set();
    const alias = aliases[t.type] || {};
    const matched = new Set();
    for (const f of [...(t.fields || []), ...(t.body || [])]) {
      const cands = [alias[f.key], f.write && f.write.field, f.key].filter(Boolean);
      const prop = cands.find(c => props.has(c) && !isSystem(c));
      if (prop) matched.add(prop);
      // 5. Есть путь записи, а значению негде лечь: ни вершина, ни версия не знают ни одного из имён поля.
      // Поле-связь пишется ребром (rel у поля, edge_fields модели: роли задачи — ROLE_HELD_BY), это не свойство.
      const isEdge = Boolean(f.rel) || Boolean(edgeFields[t.type + '.' + f.key]) || (f.write && edgeNames.has(f.write.field))
        || (f.write && legacyRoleStrings.has(f.write.field));
      const lands = cands.some(c => props.has(c) || histProps.has(c));
      if (f.write && f.write.field && !isEdge && !lands)
        writtenWithoutSchema.push({ type: t.type, field: f.key, writeField: f.write.field, vertex: g.vertex });
    }
    for (const p of props)
      if (!isSystem(p) && !isService(p, g.key) && !matched.has(p) && p !== g.key)
        unclassified.push({ type: t.type, vertex: g.vertex, property: p });
  }
}

const report = {
  about: 'SPRINT_LORE_KNOW_REGISTRY/KREG-08 — вход для KREG-02/KREG-10. Категории: факта 24.11.2026.',
  generatedFrom: { model: path.relative(repo, modelPath), schema: schemaPath ? path.relative(repo, schemaPath) : null },
  summary: {
    modelVersion: model.model_version,
    schema: schemaStatus,
    fieldsWithoutLabelKey: fieldsWithoutLabelKey.length,
    modelSchemaEdgesNotInModel: modelSchemaEdgesNotInModel.length,
    listTypesWithIssues: listTypes.filter(t => t.issues.length > 0).length,
    unclassified: unclassified.length,
    writtenWithoutSchema: writtenWithoutSchema.length,
  },
  fieldsWithoutLabelKey,
  modelSchemaEdgesNotInModel,
  listTypes,
  unclassified,
  writtenWithoutSchema,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log('ИТОГ', JSON.stringify(report.summary));
console.log('файл:', path.relative(repo, outPath));
