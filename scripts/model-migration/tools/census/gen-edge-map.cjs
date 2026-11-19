// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Генератор общей карты связей map/all.edges.json из переписи прода
// (tools/census/edge-triples.tsv). Решения по связям первого объекта берутся из map/sprint-phase-task.edges.json как есть
// (wait при полном переносе = keep); остальные виды — keep по поручению владелицы 17.11.2026 («перенеси по собственным
// рекомендациям и нашим правилам все объекты»), кроме перечисленных ниже. Запуск: node gen-edge-map.cjs
const fs = require('fs'), path = require('path');
const MAP = path.join(__dirname, '..', '..', 'map');
const first = JSON.parse(fs.readFileSync(path.join(MAP, 'sprint-phase-task.edges.json'), 'utf8'));
const triples = fs.readFileSync(path.join(__dirname, 'edge-triples.tsv'), 'utf8').trim().split(/\r?\n/).map(l => l.split('\t'));
const DELEGATED = 'владелица 17.11.2026: «перенеси по собственным рекомендациям и нашим правилам все объекты»';
const special = {
  HAS_PR: { rule: 'drop', basis: 'owner', note: 'решение владелицы: HAS_PR не переносится; связь PR ↔ задача — CLOSED_BY, PR ↔ релиз — SHIPPED_IN' },
  ON_MILESTONE: { rule: 'drop', basis: 'owner', note: 'начало связи — PlanCheckpoint; план-доска снята (D-2026-LORE-PLAN-BOARD-REMOVED)' },
  RELEASED_IN: { rule: 'convert', to: 'IMPLEMENTED_IN_RELEASE', basis: 'proposal', note: 'мёртвая связь: код её не пишет и не читает; спринт → релиз живёт в IMPLEMENTED_IN_RELEASE. Перевод без дублей. Предложение исполнителя' },
  INCLUDES: { rule: 'convert', to: 'IMPLEMENTED_IN_RELEASE', reverse: true, basis: 'proposal', note: 'мёртвая связь релиз → спринт; разворот в IMPLEMENTED_IN_RELEASE (спринт → релиз) без дублей. Предложение исполнителя' },
  // MD-02 «что выключаем»: связи к легаси-словарям, снятым V89 (#1401). В переписи прода их нет, но источник без V89
  // их несёт: без правила перенос падал бы «связь вне карты». Поэтому правило есть всегда.
  HAS_STATUS: { rule: 'drop', basis: 'owner', note: 'снята V89 (#1401): статус — код в строке версии (status_raw), словари Status* сняты; MD-02' },
  OF_TYPE: { rule: 'drop', basis: 'owner', note: 'снята V89 (#1401): вид трека — поле PlanTrack.area, словарь TrackType снят; MD-02' },
};
const ALWAYS = ['HAS_STATUS', 'OF_TYPE'];
const edges = {};
for (const e of ALWAYS) edges[e] = special[e];
for (const [e] of triples) {
  if (edges[e]) continue;
  if (special[e]) edges[e] = special[e];
  else if (first.edges[e]) edges[e] = { ...first.edges[e], rule: first.edges[e].rule === 'wait' ? 'keep' : first.edges[e].rule };
  else edges[e] = { rule: 'keep', basis: 'delegated', note: DELEGATED };
}
const out = {
  _about: 'SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01. Общая карта переноса СВЯЗЕЙ всех объектов. Источник перечня — перепись прода (tools/census/edge-triples.tsv). Сгенерирована tools/census/gen-edge-map.cjs; правки — в генераторе. Правила: keep, drop, convert (to, reverse). basis: owner / delegated / proposal.',
  _vocab: first._vocab,
  edges: Object.fromEntries(Object.entries(edges).sort(([a], [b]) => a.localeCompare(b))),
};
fs.writeFileSync(path.join(MAP, 'all.edges.json'), JSON.stringify(out, null, 1) + '\n');
console.log('видов связей:', Object.keys(edges).length, '· convert:', Object.keys(edges).filter(e => edges[e].rule === 'convert').join(', '),
  '· drop:', Object.keys(edges).filter(e => edges[e].rule === 'drop').join(', '));
