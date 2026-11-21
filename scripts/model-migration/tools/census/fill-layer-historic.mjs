#!/usr/bin/env node
// MDL-02 · Заполнение слоя и историчности полей модели ПО ФАКТАМ схемы (снимок прода, только чтение).
// Правило: свойство объявлено в типе версий → historic + stable; объявлено в вершине → stable;
// не объявлено нигде → ничего не пишем (слой не решён — это не «опциональное»).
// Поля-рёбра (rel / edge_fields) пропускаются. Сопоставление поля со свойством — как у сервера
// (LoreModelTypes.candidates): псевдоним, поле пути записи, ключ.
// Запуск: node fill-layer-historic.mjs <путь к db.mjs> <путь к lore-model.json> [--write]
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const [dbPath, modelPath] = process.argv.slice(2);
const write = process.argv.includes('--write');
const { connect } = await import(pathToFileURL(dbPath).href);
const db = connect();
const types = await db.src('SELECT name, properties FROM schema:types');
const declared = new Map(types.map(t => [t.name, new Set((t.properties || []).map(p => p.name))]));
if (declared.size < 50) throw new Error('положительный контроль: типов схемы прочитано подозрительно мало — ' + declared.size);

const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const report = [];
let stable = 0, historic = 0, unknown = 0, edges = 0;
for (const t of model.types) {
  const g = model.graph[t.type];
  const V = declared.get(g.vertex), H = g.hist ? declared.get(g.hist) : null;
  if (!V) throw new Error(`тип ${t.type}: вершины ${g.vertex} нет в схеме снимка`);
  const aliases = model.aliases[t.type] || {};
  const row = { type: t.type, stable: [], historic: [], unknown: [], edges: [] };
  const decide = (f) => {
    if (f.rel || model.edge_fields[`${t.type}.${f.key}`]) { row.edges.push(f.key); edges++; return; }
    const cands = [aliases[f.key], f.write && f.write.field, f.key].filter(Boolean);
    const inH = H && cands.find(c => H.has(c)), inV = cands.find(c => V.has(c));
    if (inH) { f.layer = 'stable'; f.historic = true; row.historic.push(f.key); historic++; stable++; }
    else if (inV) { f.layer = 'stable'; row.stable.push(f.key); stable++; }
    else { row.unknown.push(f.key); unknown++; }
  };
  for (const f of t.fields) decide(f);
  for (const b of t.body || []) decide(b);
  report.push(row);
}
for (const r of report) console.log(`${r.type}: в версии ${r.historic.length} · только вершина ${r.stable.length} · не объявлено ${r.unknown.length} [${r.unknown.join(', ')}] · рёбра ${r.edges.length}`);
console.log(`ИТОГО: стабильных ${stable} (из них историчных ${historic}), слой не решён ${unknown}, полей-рёбер ${edges}`);
if (write) { fs.writeFileSync(modelPath, JSON.stringify(model, null, 2)); console.log('записано: ' + modelPath); }
