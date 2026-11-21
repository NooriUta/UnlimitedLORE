// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 — сторож карты переноса: ни одно поле старой базы не забыто.
//
// Перенос молча теряет поле, если в карте для него нет правила. Проверка сверяет карту с
// переписью полей (снимок: тип → { fields: [{ name, filled }] }) в обе стороны:
//   · поле есть в базе, правила нет — ошибка;
//   · правило есть, поля в базе нет — предупреждение (поле могли снять);
//   · правило неизвестного вида или без обязательных частей — ошибка.
//
// Запуск: node scripts/model-migration/check-map.mjs <карта.json> <перепись-полей.json>
import { readFileSync } from 'node:fs';

const RULES = {
  keep: [],
  rename: ['to'],
  transform: ['to', 'how'],
  to_current_version: [],
  drop: ['why'],
  open: ['question'],
};
const BASIS = new Set(['owner', 'delegated', 'proposal']);

export function checkMap(map, census) {
  const errors = [];
  const warnings = [];
  const stats = { fields: 0, byRule: {}, byBasis: {} };
  for (const [type, c] of Object.entries(census)) {
    const rules = map.types?.[type];
    if (!rules) { errors.push(`${type}: типа нет в карте`); continue; }
    for (const f of c.fields) {
      stats.fields++;
      const r = rules[f.name];
      if (!r) { errors.push(`${type}.${f.name}: правила нет (заполнено у ${f.filled})`); continue; }
      const need = RULES[r.rule];
      if (!need) { errors.push(`${type}.${f.name}: неизвестное правило «${r.rule}»`); continue; }
      for (const k of need) if (!r[k]) errors.push(`${type}.${f.name}: у правила «${r.rule}» нет «${k}»`);
      if (r.rule !== 'open' && !BASIS.has(r.basis)) errors.push(`${type}.${f.name}: не указано основание (owner | delegated | proposal)`);
      stats.byRule[r.rule] = (stats.byRule[r.rule] ?? 0) + 1;
      const b = r.rule === 'open' ? 'open' : r.basis;
      stats.byBasis[b] = (stats.byBasis[b] ?? 0) + 1;
    }
    const known = new Set(c.fields.map(f => f.name));
    for (const name of Object.keys(rules)) {
      if (!known.has(name)) warnings.push(`${type}.${name}: правило есть, поля в переписи нет`);
    }
  }
  for (const type of Object.keys(map.types ?? {})) {
    if (!census[type]) warnings.push(`${type}: тип есть в карте, в переписи нет`);
  }
  return { errors, warnings, stats };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [mapPath, censusPath] = process.argv.slice(2);
  if (!mapPath || !censusPath) {
    console.error('использование: node check-map.mjs <карта.json> <перепись-полей.json>');
    process.exit(2);
  }
  const res = checkMap(JSON.parse(readFileSync(mapPath, 'utf8')), JSON.parse(readFileSync(censusPath, 'utf8')));
  for (const w of res.warnings) console.log('предупреждение: ' + w);
  for (const e of res.errors) console.log('ОШИБКА: ' + e);
  console.log(JSON.stringify(res.stats));
  process.exit(res.errors.length ? 1 : 0);
}
