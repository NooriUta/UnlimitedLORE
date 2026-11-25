// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — интерфейс установщика: диалог переноса в браузере.
// Слова владелицы 16.11.2026: «интерактивно в chrome покажи диалог миграции»; «у всех в данных будет своё
// и через HTML это странно» — диалог строится по данным своей установки, решения пишутся в её файл решений.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDecision, decisionFromForm, nextId } from './ui.mjs';
import { checkDecisions } from './decisions.mjs';

const empty = () => ({ format: 'mig-decisions/1', decisions: [] });
const AT = '2026-11-16T20:00:00Z';

test('решение из формы: свести к коду; область — значение или «пусто»', () => {
  const d = decisionFromForm({ type: 'KnowSprintHist', field: 'status_raw', value: '✅ CLOSED', action: 'map_to', to: 'DONE', by: 'omiloreadmin' }, 'ST-12', AT);
  assert.deepEqual(d.scope, { type: 'KnowSprintHist', field: 'status_raw', value: '✅ CLOSED' });
  assert.equal(d.to, 'DONE');
  const e = decisionFromForm({ type: 'KnowTaskHist', field: 'status_raw', value: null, action: 'map_to', to: 'BACKLOG', by: 'x' }, 'ST-13', AT);
  assert.deepEqual(e.scope, { type: 'KnowTaskHist', field: 'status_raw', why: 'пусто' });
});

test('новый код — только с подписями на трёх языках; «решу позже» — defer', () => {
  assert.throws(() => decisionFromForm({ type: 'KnowADRHist', field: 'status_raw', value: 'REJECTED', action: 'add_code', to: 'REJECTED', labels: { ru: 'Отклонён', en: 'Rejected' }, by: 'x' }, 'ST-1', AT), /pl/);
  const d = decisionFromForm({ type: 'KnowADRHist', field: 'status_raw', value: 'REJECTED', action: 'add_code', to: 'rejected', labels: { ru: 'Отклонён', en: 'Rejected', pl: 'Odrzucony' }, by: 'x' }, 'ST-1', AT);
  assert.equal(d.to, 'REJECTED', 'код статуса — заглавными');
  assert.equal(decisionFromForm({ type: 'T', field: 'f', value: 'v', action: 'defer', by: 'x' }, 'ST-2', AT).action, 'defer');
});

test('регистр кода — по виду справочника поля: статус заглавными, приоритет строчными (16.11: «NORMAL в priority нет»)', () => {
  const caseOf = s => (s.field === 'priority' ? 'lower' : 'upper');
  const p = decisionFromForm({ type: 'KnowSprintHist', field: 'priority', value: 'medium', action: 'map_to', to: 'normal', by: 'x' }, 'ST-74', AT, caseOf);
  assert.equal(p.to, 'normal');
  const s = decisionFromForm({ type: 'KnowSprintHist', field: 'plan_status', value: '🔴 P0', action: 'map_to', to: 'todo', by: 'x' }, 'ST-75', AT, caseOf);
  assert.equal(s.to, 'TODO');
  assert.equal(addDecision(empty(), { type: 'KnowSprintHist', field: 'priority', value: 'medium', action: 'map_to', to: 'normal', by: 'x' }, AT, caseOf).decisions[0].to, 'normal');
});

test('без «кто принял» решение не записывается', () => {
  assert.throws(() => decisionFromForm({ type: 'T', field: 'f', value: 'v', action: 'map_to', to: 'DONE', by: ' ' }, 'ST-3', AT), /кто принял/);
});

test('повторное решение по той же области заменяет прежнее; файл остаётся годным', () => {
  let doc = empty();
  doc = addDecision(doc, { type: 'KnowSprintHist', field: 'status_raw', value: '✅ CLOSED', action: 'map_to', to: 'DONE', by: 'a' }, AT);
  doc = addDecision(doc, { type: 'KnowSprintHist', field: 'status_raw', value: '✅ CLOSED', action: 'map_to', to: 'ACTIVE', by: 'a' }, AT);
  assert.equal(doc.decisions.length, 1);
  assert.equal(doc.decisions[0].to, 'ACTIVE');
  assert.deepEqual(checkDecisions(doc), []);
});

test('код решения — следующий свободный ST-NN', () => {
  assert.equal(nextId(empty()), 'ST-01');
  assert.equal(nextId({ decisions: [{ id: 'ST-01' }, { id: 'ST-11' }, { id: 'X-99' }] }), 'ST-12');
});

// Сверка палитры установщика с фирменной Amber Forest kit (17.11) переехала в web-next/src/installerPalette.test.ts
// (K5-PACKAGE-DELIVERY, 25.11): kit теперь пакет @seidr/kit в web-next/node_modules, а этот прогон (node --test)
// идёт без установки зависимостей.

// 20.11.2026, Playwright-проход мастера на ryzenai: «Зв» и «Ж» есть в меню, но по адресу #step-d / #step-w
// открывался «Старт» — stepFromHash не знал этих шагов (перезагрузка и прямая ссылка уводили на первый экран).
// Правило: каждый шаг меню открывается своим адресом.
test('каждый шаг меню открывается по своему адресу #step-<x>', async () => {
  const { pageHtml } = await import('./ui.mjs');
  const html = pageHtml();
  const steps = [...html.matchAll(/data-step="([a-z0-9]+)"/g)].map(m => m[1]);
  assert.ok(steps.length >= 14, 'шаги меню найдены: ' + steps.join(','));
  const src = /function stepFromHash\(\)\{var m=(\/.*?\/)\.exec/.exec(html);
  assert.ok(src, 'stepFromHash найден в странице');
  const re = new Function('return ' + src[1])();
  const lost = steps.filter(s => !re.test('#step-' + s));
  assert.deepEqual(lost, [], 'шаги, которые по адресу открывают «Старт»');
});
