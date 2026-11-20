// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06 — pr_refs одного вида после переноса.
// В проде у KnowSprintHist.pr_refs вперемешку: число, строка с номерами через запятую, список, ссылки
// markdown на PR в GitHub и Forgejo, ссылки на релизы. Перенос удерживает поле до шага связей (MD-05:
// номера становятся связью спринта с PR), но удержанное значение теперь одного вида:
// { prs: ['хост/владелец/репозиторий#N' | '#N', …], note?: 'остаток текста' } — номер без адреса
// репозитория не угадывается, остаток (релизы, «merged develop …») не теряется.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyMap, toPrRefs } from './apply-map.mjs';
import { fieldValues } from './decision-refs.mjs';

const MAP = JSON.parse(fs.readFileSync(new URL('./map/sprint-phase-task.json', import.meta.url), 'utf8')).types;
const ALL = JSON.parse(fs.readFileSync(new URL('./map/all-objects.json', import.meta.url), 'utf8')).types;
const ctx = { statusCodes: { sprint: ['planned'] } };

test('pr_refs: число, строка номеров и список — один вид', () => {
  assert.deepEqual(toPrRefs(367), { prs: ['#367'] });
  assert.deepEqual(toPrRefs('367'), { prs: ['#367'] });
  assert.deepEqual(toPrRefs('101,102, 103'), { prs: ['#101', '#102', '#103'] });
  assert.deepEqual(toPrRefs('#101, #102'), { prs: ['#101', '#102'] });
  assert.deepEqual(toPrRefs([420]), { prs: ['#420'] });
  assert.deepEqual(toPrRefs(['PR13']), { prs: ['#13'] });
  assert.deepEqual(toPrRefs([420, '420']), { prs: ['#420'] }, 'повтор схлопывается');
});

test('pr_refs: ссылка markdown — номер с адресом репозитория, хост различается', () => {
  assert.deepEqual(toPrRefs('[#1497](https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1497)'),
    { prs: ['git.seidrstudio.pro/AIDA/UnlimitedLORE#1497'] });
  assert.deepEqual(toPrRefs('[PR #12](https://github.com/NooriUta/AIDA/pull/12), [PR #13](https://github.com/NooriUta/AIDA/pull/13)'),
    { prs: ['github.com/NooriUta/AIDA#12', 'github.com/NooriUta/AIDA#13'] });
  // адрес без /pull/ — номер из подписи, репозиторий из адреса
  assert.deepEqual(toPrRefs('[#7](https://github.com/NooriUta/UnlimitedLORE/7)'), { prs: ['github.com/NooriUta/UnlimitedLORE#7'] });
});

test('pr_refs: релиз и приписки не теряются — уходят в note', () => {
  assert.deepEqual(toPrRefs('PR [#394](https://github.com/NooriUta/AIDA/pull/394) · [v1.2.3](https://github.com/NooriUta/AIDA/releases/tag/v1.2.3)'),
    { prs: ['github.com/NooriUta/AIDA#394'], note: '[v1.2.3](https://github.com/NooriUta/AIDA/releases/tag/v1.2.3)' });
  assert.deepEqual(toPrRefs(['PR [#394](https://github.com/NooriUta/AIDA/pull/394) → merged develop 2026-06-21']),
    { prs: ['github.com/NooriUta/AIDA#394'], note: 'merged develop 2026-06-21' });
  assert.deepEqual(toPrRefs('см. обсуждение'), { prs: [], note: 'см. обсуждение' });
});

test('перенос: удержанный pr_refs спринта и версии — одного вида; у решения — пересадка на связи (MDL-08 ч.2)', () => {
  const rec = applyMap('KnowSprint', MAP.KnowSprint, { sprint_id: 'S', pr_refs: '#101, #102' }, ctx);
  assert.deepEqual(rec.held.pr_refs, { prs: ['#101', '#102'] });
  const ver = applyMap('KnowSprintHist', MAP.KnowSprintHist, { pr_refs: [420] }, ctx);
  assert.deepEqual(ver.held.pr_refs, { prs: ['#420'] });
  const dec = applyMap('KnowDecision', ALL.KnowDecision, { pr_refs: '[#5](https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/5)' }, ctx);
  assert.equal(dec.held.pr_refs, undefined, 'решение: не удерживается — шаг связей decision-refs.mjs');
  assert.deepEqual(fieldValues('pr_refs', '[#5](https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/5)'), ['git.seidrstudio.pro/AIDA/UnlimitedLORE#5'], 'тот же вид MDL-06 у значения пересадки');
  for (const r of [rec, ver, dec]) assert.ok(!('pr_refs' in r.out), 'в запись новой базы поле не идёт — до шага связей');
});
