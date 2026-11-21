// Решения владелицы из прототипа «Перенос» (вставка в диалог 16.11.2026) → файл решений нашей установки
// и согласование подсказок/статуса по умолчанию с ними.
const fs = require('fs');
const dir = process.argv[2] + '/';
const at = '2026-11-16T16:40:00Z', by = 'omiloreadmin';
const D = (id, type, value, to, n) => ({ id, scope: value === null ? { type, field: type === 'KnowSpecHist' || type === 'KnowQuestion' || type === 'KnowUseCase' || type === 'QualityGate' ? 'status' : 'status_raw', why: 'пусто' } : { type, field: 'status_raw', value }, action: 'map_to', to, by, at, note: `решение владелицы в прототипе «Перенос», 16.11.2026; записей ${n}` });
const doc = {
  format: 'mig-decisions/1',
  _about: 'Решения владелицы для установки LORE (system_aida_lore), приняты в прототипе раздела «Перенос» 16.11.2026 и присланы в диалог списком «Решения по переносу (11)». Передаётся установщику ключом --decisions.',
  decisions: [
    D('ST-01', 'KnowADRHist', null, 'DRAFT', 152),
    D('ST-02', 'KnowDecisionHist', 'fixed', 'ACCEPTED', 114),
    D('ST-03', 'KnowDecisionHist', 'done', 'ACCEPTED', 20),
    D('ST-04', 'KnowDecisionHist', 'rejected', 'SUPERSEDED', 2),
    D('ST-05', 'KnowDecisionHist', '🚫 CANCELLED', 'SUPERSEDED', 1),
    D('ST-06', 'KnowMilestoneHist', null, 'UPCOMING', 38),
    D('ST-07', 'KnowSpecHist', null, 'PROPOSED', 607),
    D('ST-08', 'KnowTaskHist', null, 'BACKLOG', 108),
    D('ST-09', 'KnowTaskHist', '⏸ DEFERRED', 'WAITING', 10),
    D('ST-10', 'KnowUseCase', null, 'PROPOSED', 3),
    D('ST-11', 'QualityGate', null, 'DRAFT', 1),
  ],
};
fs.writeFileSync(dir + 'rules/decisions.lore.json', JSON.stringify(doc, null, 2) + '\n');
// Подсказки и умолчание — вслед за её выбором.
const p = dir + 'rules/status-unification.json';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
r.dictionaries.plan_status.empty_default = 'BACKLOG';
r.dictionaries.plan_status._empty_default = 'Пустой статус спринта и задачи → BACKLOG: правило владелицы «если статус не указан при создании ставим первый статус в беклог» и её решение ST-08 от 16.11.2026.';
const h = r.hints;
const pause = h.find(x => x.match.startsWith(String.raw`\b(PAUSED`));
pause.match = String.raw`\b(Conditional|Stub|Proposed)\b`; pause.why = 'ещё не проработано';
h.splice(h.indexOf(pause), 0, { tier: 'phrase', match: String.raw`\b(PAUSED|DEFERRED)\b|ОТЛОЖЕН`, to: 'WAITING', why: 'отложено — как в решении владелицы ST-09 («⏸ DEFERRED» → WAITING)' });
h.find(x => x.tier === 'marker' && x.match === '⏸').to = 'WAITING';
h.splice(1, 0, { tier: 'phrase', match: String.raw`^(rejected)$|CANCELLED`, to: 'SUPERSEDED', why: 'как в решениях владелицы ST-04, ST-05', dict: ['decision_status'] });
fs.writeFileSync(p, JSON.stringify(r, null, 2) + '\n');
console.log('решений', doc.decisions.length, 'подсказок', h.length);
