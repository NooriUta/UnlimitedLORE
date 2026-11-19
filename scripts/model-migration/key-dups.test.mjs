// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · дубли уникального ключа справочника при переносе (D-2026-MIG-SETTING-LIST-VALUE).
// Слово владелицы 18.11.2026: «можно отрезать организацию логин и все будет нормально но репозиторий один основной
// остальное зеркала». На снимке две строки app_setting/qg.actions_projects: «AIDA/UnlimitedLORE» и
// «NooriUta/UnlimitedLORE» — уникальный индекс KnowDictEntry(dict_type, code) из-за них не создавался.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeKeyDups } from './key-dups.mjs';

const row = (rid, code, label, active) => ({ rid, res: { out: { dict_type: 'app_setting', code, label_ru: label, ...(active === undefined ? {} : { is_active: active }) } } });

test('значения отличаются только организацией — одна строка со slug проекта LORE; лишняя — в остаток с причиной', () => {
  // опросчик QG ищет проект по slug (KnowGitProject) и берёт его основной репозиторий: значение — slug проекта LORE
  const rows = [row('#340:155', 'qg.actions_projects', 'AIDA/UnlimitedLORE'), row('#340:156', 'qg.actions_projects', 'NooriUta/UnlimitedLORE', true)];
  const { keep, leftovers } = mergeKeyDups(rows, ['dict_type', 'code'], 'label_ru', new Set(['NooriUta/UnlimitedLORE']));
  assert.equal(keep.length, 1);
  assert.equal(keep[0].rid, '#340:156', 'остаётся активная строка');
  assert.equal(keep[0].res.out.label_ru, 'NooriUta/UnlimitedLORE');
  assert.deepEqual(leftovers.map(x => [x.src_rid, x.kind]), [['#340:155', 'merged_duplicate']]);
  assert.match(leftovers[0].why, /организац/);
});

test('значения разные по сути — не сливаются: все строки остаются, в отчёт — конфликт ключа', () => {
  const rows = [row('#1:1', 'x', 'alpha'), row('#1:2', 'x', 'beta')];
  const { keep, conflicts } = mergeKeyDups(rows, ['dict_type', 'code'], 'label_ru');
  assert.equal(keep.length, 2);
  assert.deepEqual(conflicts, [{ key: 'app_setting|x', rids: ['#1:1', '#1:2'], values: ['alpha', 'beta'] }]);
});

test('без дублей — ничего не меняется', () => {
  const rows = [row('#1:1', 'a', 'A'), row('#1:2', 'b', 'B')];
  const r = mergeKeyDups(rows, ['dict_type', 'code'], 'label_ru');
  assert.equal(r.keep.length, 2);
  assert.deepEqual(r.leftovers, []);
  assert.deepEqual(r.conflicts, []);
});

test('ни одно значение не slug проекта — значение без организации', () => {
  const rows = [row('#2:1', 'k', 'org1/Name'), row('#2:2', 'k', 'org2/Name')];
  const { keep } = mergeKeyDups(rows, ['dict_type', 'code'], 'label_ru', new Set());
  assert.equal(keep[0].res.out.label_ru, 'Name');
});
