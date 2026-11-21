#!/usr/bin/env node
// MDL-04 · Тексты полей из книги декларации (texts/sprint-phase-task.json) → файл модели.
// Берётся только то, что принято владелицей: src = owner | accepted | universal. Название (label) не трогается —
// это подпись интерфейса со своим ключом локализации. Сопоставление поля со свойством — как у сервера:
// псевдоним, поле пути записи, ключ; текст ищется в вершине, затем в типе версий.
// Запуск: node fill-field-texts.mjs <texts.json> <lore-model.json> [--write]
import fs from 'node:fs';
const [textsPath, modelPath] = process.argv.slice(2);
const write = process.argv.includes('--write');
const texts = JSON.parse(fs.readFileSync(textsPath, 'utf8')).types;
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const OK = new Set(['owner', 'accepted', 'universal']);
const all = [...model.types, ...(model.child_only || [])];
let filled = 0, seen = 0;
for (const t of all) {
  const g = model.graph[t.type];
  const vertex = g ? g.vertex : { phase: 'KnowPhase' }[t.type];
  const hist = g ? g.hist : vertex && vertex + 'Hist';
  if (!vertex || !texts[vertex]) continue;
  const aliases = model.aliases[t.type] || {};
  const miss = [], hit = [];
  for (const f of [...t.fields, ...(t.body || [])]) {
    seen++;
    if (f.rel) continue;
    const cands = [aliases[f.key], f.write && f.write.field, f.key].filter(Boolean);
    let x = null;
    for (const T of [vertex, hist]) for (const c of cands) if (!x && texts[T] && texts[T][c]) x = texts[T][c];
    if (!x) { miss.push(f.key); continue; }
    const s = x.src || {};
    let any = false;
    if (x.short && OK.has(s.short) && x.short !== f.label) { f.shortLabel = x.short; any = true; }
    if (x.def && OK.has(s.def)) { f.definition = x.def; any = true; }
    if (x.desc && OK.has(s.desc)) { f.description = x.desc; any = true; }
    if (any) { filled++; hit.push(f.key); } else miss.push(f.key + ' (текст не принят)');
  }
  console.log(`${t.type}: тексты у ${hit.length} [${hit.join(', ')}] · без текста [${miss.join(', ')}]`);
}
console.log(`ИТОГО: полей просмотрено ${seen}, с текстами ${filled}`);
if (!filled) throw new Error('положительный контроль: ни одно поле не получило текст');
if (write) { fs.writeFileSync(modelPath, JSON.stringify(model, null, 2)); console.log('записано'); }
