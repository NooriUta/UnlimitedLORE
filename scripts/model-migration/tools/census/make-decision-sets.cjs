// Два набора решений для приёмки на двух машинах (слово владелицы 16.11.2026: «прийми решения как у тебя и
// прогони все потом в windows и Linux прими разные решения и тоже сверь»).
// A — «как у меня»: предложение конвейера; без предложения — правила ниже. B — другие выборы по каждой строке.
// Оба набора начинаются с 11 её решений (rules/decisions.lore.json) и пишутся ВНЕ репозитория.
const fs = require('fs');
const dlg = JSON.parse(fs.readFileSync('C:/AIDA/_audit_scripts/mig/dlg-base.json', 'utf8'));
const base = JSON.parse(fs.readFileSync('C:/AIDA/UnlimitedLORE/.claude/worktrees/mig/scripts/model-migration/rules/decisions.lore.json', 'utf8'));
const rules = JSON.parse(fs.readFileSync('C:/AIDA/UnlimitedLORE/.claude/worktrees/mig/scripts/model-migration/rules/status-unification.json', 'utf8'));
const at = '2026-11-16T18:30:00Z';
const waiting = dlg.rows.filter(r => r.state === 'needs_decision');
const codesOf = dict => rules.dictionaries[dict].codes.map(c => c.code);

// A: без предложения — моё правило. Фаза: название в поле статуса → PLANNED (предложено вам 16.11);
// «🚫 CANCELLED» у фазы → новый код CANCELLED с подписями; «🔴 BLOCKED» у фазы → ACTIVE (фаза идёт, задача стоит).
// Спринт: ARCHIVED → DONE; SPLIT → CANCELLED (элемент разделён на два, сам не идёт); «🔴 P0» в статусе → BACKLOG.
// Приоритет «medium» → normal (её словесная шкала: P2 → normal).
function pickA(r) {
  const v = String(r.value);
  if (r.suggest) return { action: 'map_to', to: r.suggest };
  if (r.dict === 'phase_status') {
    if (/CANCELLED/.test(v)) return { action: 'add_code', to: 'CANCELLED', labels: { ru: 'Отменена', en: 'Cancelled', pl: 'Anulowana' } };
    if (/BLOCKED/.test(v)) return { action: 'map_to', to: 'ACTIVE' };
    return { action: 'map_to', to: 'PLANNED' };
  }
  if (r.dict === 'plan_status') {
    if (/^ARCHIVED$/.test(v)) return { action: 'map_to', to: 'DONE' };
    if (/SPLIT/.test(v)) return { action: 'map_to', to: 'CANCELLED' };
    return { action: 'map_to', to: 'BACKLOG' };
  }
  if (r.dict === 'priority') return { action: 'map_to', to: 'normal' };
  throw new Error('нет правила A для ' + r.type + ' ' + v);
}
// B: по каждой строке — другой код того же справочника, детерминированно: следующий за кодом A по порядку справочника.
function pickB(r) {
  const a = pickA(r), codes = codesOf(r.dict);
  if (a.action === 'add_code') return { action: 'map_to', to: 'BACKLOG' };
  const i = codes.indexOf(a.to);
  return { action: 'map_to', to: codes[(i + 1) % codes.length] };
}
function build(pick, tag) {
  const doc = { format: 'mig-decisions/1', _about: `Набор ${tag} для приёмки на двух машинах, 16.11.2026; 11 решений владелицы + решения агента по остальным строкам. Не для прода.`, decisions: [...base.decisions] };
  let n = doc.decisions.length;
  for (const r of waiting) {
    const p = pick(r);
    const scope = r.value === null ? { type: r.type, field: r.field, why: 'пусто' } : { type: r.type, field: r.field, value: r.value };
    doc.decisions.push({ id: `${tag}-${String(++n).padStart(3, '0')}`, scope, ...p, by: 'агент dc5b1ddc по слову владелицы «прийми решения как у тебя»', at });
  }
  return doc;
}
const A = build(pickA, 'A'), B = build(pickB, 'B');
fs.writeFileSync('C:/AIDA/_audit_scripts/mig/decisions-A.json', JSON.stringify(A, null, 2) + '\n');
fs.writeFileSync('C:/AIDA/_audit_scripts/mig/decisions-B.json', JSON.stringify(B, null, 2) + '\n');
const diff = A.decisions.filter((d, i) => JSON.stringify(d.to) !== JSON.stringify(B.decisions[i].to)).length;
console.log('A', A.decisions.length, 'B', B.decisions.length, 'различаются выбором', diff);
