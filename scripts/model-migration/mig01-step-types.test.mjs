// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 — две находки пробы MDL-08 на ryzenai (20.11.2026, снимок migration_src_2026_11_18).
//
// 1. Повторный перенос с --reset отказывал: «в приёмнике есть чужие типы: ANSWERABLE_BY». Шаг связей заводит ребро
//    ответственного вопроса, а список своих типов переноса (ownTypes) его не знал. Правило: свои типы шага связей —
//    один список (EDGE_STEP_TYPES), из которого собран ownTypes; любой тип, который код установщика заводит
//    командой CREATE … TYPE, обязан быть в ownTypes — новый тип связи больше не выпадет.
// 2. «Сверка вида продуктов: НЕ сошлась, без вида 17» при полном product_kind в файле решений: шаг связей запускали
//    без --decisions, loadDecisions() без файла отдаёт «решений нет», и все решения шага (вид продукта,
//    перегруппировка, задачи без спринта, решение → веха) молча не применялись. Правило: команда, пишущая в новую
//    базу, без файла решений не запускается.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ownTypes } from './transfer.mjs';
import { EDGE_STEP_TYPES } from './step-types.mjs';
import { OWNER_EDGE } from './question-owner.mjs';
import { MILESTONE_EDGE } from './decision-milestones.mjs';
import { SESSION_EDGES } from './session-model.mjs';
import { REPO_TYPES } from './repos.mjs';
import { parseArgs, checkDecisionsFile } from './cli.mjs';

test('ANSWERABLE_BY — свой тип переноса: повторный перенос с --reset его пересоздаёт, а не отказывает', () => {
  assert.equal(OWNER_EDGE, 'ANSWERABLE_BY');
  assert.ok(ownTypes().includes('ANSWERABLE_BY'));
});

test('свои типы шага связей — один список; ownTypes собран из него', () => {
  for (const t of [OWNER_EDGE, MILESTONE_EDGE, ...SESSION_EDGES, ...REPO_TYPES]) assert.ok(EDGE_STEP_TYPES.includes(t), t);
  const own = ownTypes();
  for (const t of EDGE_STEP_TYPES) assert.ok(own.includes(t), t);
});

// Сторож: каждая команда CREATE … TYPE в коде установщика заводит тип, известный ownTypes. Имя литералом — сверяется
// прямо; имя константой — по её значению; имя переменной цикла — только в местах, где цикл идёт по своему списку.
const CONST = { OWNER_EDGE, MILESTONE_EDGE, EDGE: 'HAS_STATE', ENTRY: 'MigDictEntry', LABEL: 'MigDictLabel' };
const LOOP_SITES = {
  'transfer.mjs': 'T — типы схемы переноса (SCHEMA)',
  'transfer-edges.mjs': 'T — связи карты (keptEdges), E — связи модели сессий (SESSION_EDGES)',
  'repos.mjs': 't — ORG_EDGES и связи репозиториев (REPO_TYPES)',
};
test('сторож: любой тип, который заводит код установщика, — в ownTypes', () => {
  const own = new Set(ownTypes());
  const files = fs.readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && !/^layer-experiments/.test(f));
  const bad = [], seen = [];
  for (const f of files) {
    const src = fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');
    for (const m of src.matchAll(/CREATE (?:EDGE|VERTEX|DOCUMENT) TYPE (\$\{(\w+)\}|[A-Za-z_]\w*)/g)) {
      const name = m[2] ? (CONST[m[2]] ?? null) : m[1];
      seen.push(f + ':' + m[1]);
      if (name === null) { if (!LOOP_SITES[f] || !/^[TEt]$/.test(m[2])) bad.push(`${f}: имя ${m[1]} — не литерал и не известная константа`); continue; }
      if (name === 'IF' || name === 'LoreBootProbe') continue;
      if (!own.has(name)) bad.push(`${f}: ${name} вне ownTypes`);
    }
  }
  assert.ok(seen.length >= 10, 'сторож нашёл места создания типов: ' + seen.length);
  assert.deepEqual(bad, []);
});

test('пишущая команда без файла решений не запускается: решения шага молча не применились бы', () => {
  const saved = process.env.MIG_DECISIONS_FILE;
  delete process.env.MIG_DECISIONS_FILE;
  try {
    for (const c of ['transfer', 'edges']) assert.match(parseArgs([c, '--env', 'a.env']).error, /--decisions/, c);
    assert.equal(parseArgs(['edges', '--env', 'a.env', '--decisions', 'd.json']).error, undefined);
    assert.equal(parseArgs(['dry-run', '--env', 'a.env']).error, undefined, 'читающая команда — без файла можно');
    process.env.MIG_DECISIONS_FILE = 'd.json';
    assert.equal(parseArgs(['edges', '--env', 'a.env']).error, undefined, 'файл решений из окружения');
  } finally { if (saved === undefined) delete process.env.MIG_DECISIONS_FILE; else process.env.MIG_DECISIONS_FILE = saved; }
});

test('файл решений указан, но его нет — ошибка с путём, а не «решений нет»', () => {
  assert.match(checkDecisionsFile('/нет/такого/decisions.json'), /файла решений нет: .*decisions\.json/);
  assert.equal(checkDecisionsFile(new URL('./rules/decisions.lore.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), null);
});

test('сценарии прогонов передают файл решений и шагу связей', () => {
  const dir = new URL('./tools/run/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sh'))) {
    for (const line of fs.readFileSync(new URL(f, dir), 'utf8').split('\n')) {
      if (/\bedges --env\b/.test(line)) assert.match(line, /--decisions/, f + ': ' + line.trim());
    }
  }
});
