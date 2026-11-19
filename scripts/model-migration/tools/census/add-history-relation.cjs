// LORE-DOOR-HISTORY-ALL-PASSPORTS · вкладка истории в модели у типов с версиями и дверью истории.
const fs = require('fs');
const p = process.argv[2];
const m = JSON.parse(fs.readFileSync(p, 'utf8'));
const sample = m.types.find(t => t.type === 'spec').relations.find(r => r.place === 'history');
const added = [];
for (const type of ['decision', 'milestone', 'release', 'runbook']) {
  const t = m.types.find(x => x.type === type);
  if (!t) throw new Error('нет типа ' + type);
  if (m.time[type].history !== 'scd2') throw new Error(type + ': версий нет');
  if (t.relations.some(r => r.place === 'history')) continue;
  t.relations.push({ ...sample });
  added.push(type);
}
fs.writeFileSync(p, JSON.stringify(m, null, 2));
console.log('вкладка истории добавлена: ' + added.join(', '));
