// SPRINT_LORE_MODEL_DOCS_TIDY/MD-03 · спека схемы LORE_DB_SCHEMA_MERMAID генерируется из модели 1.18, не пишется руками.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchemaSpec, areaOf, supersededBody, AREAS, SCHEMA_SPEC_ID } from './schema-spec.mjs';
import loreModel from '../../shared/model/lore-model.json' with { type: 'json' };
import edgesMap from './map/all.edges.json' with { type: 'json' };
import objectsMap from './map/all-objects.json' with { type: 'json' };

const build = () => buildSchemaSpec({ model: loreModel, edgesMap, objectsMap, source: 'тест' });
const blocks = md => [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m => m[1]);
const allTypes = [...loreModel.types, ...loreModel.child_only];

test('у каждого типа модели есть область; новый тип без области валит тест, а не пропадает со схемы', () => {
  for (const t of allTypes) assert.ok(AREAS.some(a => a.id === areaOf(t.type, loreModel)), 'область для ' + t.type);
});

test('каждый блок — Mermaid с раскладкой ELK в frontmatter и flowchart TB', () => {
  const b = blocks(build().md);
  assert.ok(b.length >= 5, 'блоков по областям: ' + b.length);
  for (const x of b) {
    assert.match(x, /^---\nconfig:\n {2}layout: elk\n/);
    assert.match(x, /\n---\nflowchart TB\n/);
  }
});

test('каждая связь модели между конкретными типами есть на схеме своей области либо в строке веера', () => {
  const md = build().md;
  const diag = blocks(md).join('\n');
  for (const t of allTypes) for (const r of t.relations || []) {
    if (r.targetType === 'any' || r.targetType === 'hist') continue;
    const [a, b] = r.dir === 'in' ? [r.targetType, t.type] : [t.type, r.targetType];
    const drawn = new RegExp(`\\b${a}\\s+(-->|==>|-\\.->)\\|${r.rel}\\|\\s+${b}\\b`).test(diag);
    const fan = md.split('\n').find(l => l.startsWith(`- **${r.rel} → ${b}**`));
    assert.ok(drawn || (fan && new RegExp(`\\b${a}\\b`).test(fan)), `${a} -${r.rel}-> ${b}`);
  }
});

test('веер (одна связь в одну цель из ≥6 типов) не рисуется стрелками, а перечисляется строкой', () => {
  const md = build().md;
  const diag = blocks(md).join('\n');
  assert.ok(!/\|BELONGS_TO_PROJECT\|/.test(diag), 'BELONGS_TO_PROJECT на схемах');
  assert.match(md, /^- \*\*BELONGS_TO_PROJECT → project\*\* \(\d+\): /m);
});

test('схема области не шире разумного: не больше 35 стрелок на блок (было 40 у «Проекты и система» до свёртки вееров)', () => {
  for (const x of blocks(build().md)) assert.ok((x.match(/\|[A-Z_]+\|/g) || []).length <= 35, x.split('\n')[8]);
});

test('на схеме нет снятых имён: LoreTag, PlanItem, REPRESENTS, CONTRIBUTES_TO, HAS_STATUS, Status*', () => {
  const diag = blocks(build().md).join('\n');
  for (const n of ['LoreTag', 'PlanItem', 'REPRESENTS', 'CONTRIBUTES_TO', 'HAS_STATUS', 'StatusTask', 'PlanConfig']) assert.ok(!diag.includes(n), n);
});

test('таблица типов: строка на каждый тип модели, вершина и ключ — из model.graph', () => {
  const { md } = build();
  for (const t of loreModel.types) {
    const g = loreModel.graph[t.type];
    assert.match(md, new RegExp(`\\| ${t.type} \\| [^\\n]*\\| ${g.vertex} \\|`), 'строка ' + t.type);
  }
});

test('снятое в 1.18 перечислено из карты переноса, с причиной', () => {
  const { md } = build();
  for (const [T, why] of Object.entries(objectsMap.skipped)) assert.ok(md.includes(`| ${T} | ${why.replace(/\|/g, '\\|')} |`), T);
  for (const [E, r] of Object.entries(edgesMap.edges)) if (r.rule === 'drop') assert.ok(md.includes(`| ${E} |`), E);
});

test('идентификаторы узлов безопасны для Mermaid: латиница, без зарезервированного end', () => {
  for (const x of blocks(build().md)) for (const m of x.matchAll(/^\s+([A-Za-z0-9_]+)\[/gm)) {
    assert.match(m[1], /^[a-z_][a-z0-9_]*$/);
    assert.notEqual(m[1], 'end');
  }
});

test('детерминизм: две сборки дают один и тот же текст', () => {
  assert.equal(build().md, build().md);
});

test('спека ссылается на словарь MD-01, а не повторяет поля', () => {
  const { md } = build();
  for (const d of ['lore_model_dictionary', 'lore_model_dictionary_edges', 'lore_model_dictionary_other_types']) assert.ok(md.includes(`[[${d}]]`), d);
});

test('тело замещённой спеки: шапка с заменой и причиной сверху, прежний текст сохранён ниже', () => {
  const body = supersededBody({ was: '# Старое\n\nтекст', by: [SCHEMA_SPEC_ID, 'lore_model_dictionary'], why: 'описывает 36 типов из 89' });
  assert.match(body, /^> \*\*Замещена/);
  assert.ok(body.includes(`[[${SCHEMA_SPEC_ID}]]`) && body.includes('[[lore_model_dictionary]]'));
  assert.ok(body.includes('описывает 36 типов из 89'));
  assert.ok(body.endsWith('# Старое\n\nтекст'));
  assert.equal(supersededBody({ was: body, by: [SCHEMA_SPEC_ID], why: 'x' }), body, 'повторный запуск не наращивает шапку');
});
