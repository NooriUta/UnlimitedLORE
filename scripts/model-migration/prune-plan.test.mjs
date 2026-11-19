// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Чистка lore-installer в kkRepo. Слово владелицы 18.11.2026: «сразу сделай prune,
// не оставляй в репозитории версий старше 10 минорных и только мажорные».
// Прочтение исполнителя: последние 10 минорных линий (major.minor) — все их версии; всё старше — только X.0.0.
// Предварительные сборки (…-preview.*) — последние 5 по порядку выкладки, остальные удаляются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prunePlan } from './prune-plan.mjs';

test('последние 10 минорных линий остаются целиком, старше — только X.0.0', () => {
  const v = [];
  for (let m = 0; m <= 14; m++) { v.push(`1.${m}.0`, `1.${m}.1`); }
  v.push('0.9.0', '0.9.3', '0.0.0');
  const { keep, remove } = prunePlan(v.map(x => ({ version: x })));
  for (let m = 5; m <= 14; m++) { assert.ok(keep.includes(`1.${m}.0`)); assert.ok(keep.includes(`1.${m}.1`)); }
  assert.ok(keep.includes('1.0.0'), 'мажорная 1.0.0 остаётся');
  assert.ok(keep.includes('0.0.0'), 'мажорная 0.0.0 остаётся');
  assert.ok(remove.includes('1.4.1') && remove.includes('1.4.0') && remove.includes('1.0.1') && remove.includes('0.9.3') && remove.includes('0.9.0'));
  assert.equal(keep.length + remove.length, v.length);
});

test('меньше 10 линий — ничего не удаляется', () => {
  const { remove } = prunePlan(['1.0.0', '1.1.0', '1.1.5', '2.0.0'].map(version => ({ version })));
  assert.deepEqual(remove, []);
});

test('порядок — по числам, а не по строкам: 1.10 новее 1.9', () => {
  const v = ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0', '1.8.0', '1.9.0', '1.10.0', '1.11.0'];
  const { keep, remove } = prunePlan(v.map(version => ({ version })));
  assert.deepEqual(remove, ['1.1.0']);
  assert.ok(keep.includes('1.10.0') && keep.includes('1.11.0'));
});

test('предварительные: последние 5 по времени выкладки, в счёт минорных линий не входят', () => {
  const pre = Array.from({ length: 8 }, (_, i) => ({ version: `0.0.0-preview.${'abcdef0' + i}`, at: `2026-11-18T0${i}:00:00Z` }));
  const { keep, remove } = prunePlan([...pre, { version: '1.0.0' }]);
  assert.equal(remove.length, 3);
  assert.ok(remove.includes('0.0.0-preview.abcdef00') && remove.includes('0.0.0-preview.abcdef02'));
  assert.ok(keep.includes('1.0.0') && keep.includes('0.0.0-preview.abcdef07'));
});

test('каталог не по образцу версии не трогаем — удалять только то, что поняли', () => {
  const { keep, remove } = prunePlan([{ version: 'latest' }, { version: 'README' }]);
  assert.deepEqual(remove, []);
  assert.deepEqual(keep.sort(), ['README', 'latest']);
});

test('каталоги версий из списка файлов kkRepo (search/assets): версия — первый сегмент пути', async () => {
  const { versionsFromAssets } = await import('./prune-plan.mjs');
  const m = versionsFromAssets([
    { path: '1.0.0/lore-migrate-1.0.0.mjs' }, { path: '/1.0.0/SHA256SUMS' }, { path: '1.1.0/SHA256SUMS' }, { path: 'stray.txt' },
  ]);
  assert.deepEqual(Object.keys(m).sort(), ['1.0.0', '1.1.0']);
  assert.deepEqual(m['1.0.0'].sort(), ['1.0.0/SHA256SUMS', '1.0.0/lore-migrate-1.0.0.mjs']);
});
