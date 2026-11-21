// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08 — снятие легаси-полей правилом переноса (1.18: схема собирается заново из модели,
// поэтому снятие — правило карты, а не шаг V). Владелица 20.11.2026: «mdl08 мы же утвердили уже, все поля».
// Ничего не теряется молча: непустое значение — в остаток MigLeftover (kind legacy_field), отчёт сверяет «было = остаток».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ruleFor, proposeMap } from './propose-map-all.mjs';
import { applyMap } from './apply-map.mjs';
import { LEGACY, LEGACY_WHY, legacyRule, countLegacyBefore, legacyLeftovers, legacyDrop, assertLegacyDrop } from './legacy.mjs';

const J = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const LIST = J('./rules/legacy-fields.json');
const MAPS = { ...J('./map/sprint-phase-task.json').types, ...J('./map/all-objects.json').types };
const SCHEMA = { ...J('./schema/sprint-phase-task.json').types, ...J('./schema/all-objects.json').types };

test('список легаси: 17 полей, основание — слово владелицы 20.11.2026, у каждого поля сказано, куда ушёл смысл', () => {
  assert.equal(LIST.basis, 'owner');
  assert.equal(LIST.approved, '2026-11-20');
  assert.match(LIST.words, /мы же утвердили уже, все поля/);
  const keys = Object.keys(LIST.fields);
  assert.equal(keys.length, 17);
  assert.deepEqual(keys, [...keys].sort(), 'по имени — детерминированный порядок');
  for (const k of keys) { assert.match(k, /^[A-Za-z]+\.[a-z_]+$/, k); assert.ok(LIST.fields[k].trim(), k + ': куда ушло значение'); }
  assert.deepEqual([...LEGACY.keys()].filter(k => LIST.fields[k]).sort(), keys);
});

test('правило: не переносится, причина «легаси, MDL-08, утверждено владелицей 20.11.2026»', () => {
  const r = legacyRule('KnowPR', 'pr_id');
  assert.equal(r.rule, 'drop');
  assert.equal(r.legacy, true);
  assert.equal(r.basis, 'owner');
  assert.match(r.why, /^легаси, MDL-08, утверждено владелицей 20\.11\.2026: «mdl08 мы же утвердили уже, все поля»/);
  assert.match(r.why, /pr_uid/, 'в причине — куда ушёл смысл');
  assert.equal(legacyRule('KnowPR', 'pr_uid'), null);
  assert.match(LEGACY_WHY, /MDL-08/);
});

test('генератор карты ставит правило легаси раньше прочих (даже поверх «как есть» и дат)', () => {
  assert.deepEqual(ruleFor('KnowPR', 'repo'), legacyRule('KnowPR', 'repo'));
  assert.deepEqual(ruleFor('KnowMilestoneHist', 'planned_date'), legacyRule('KnowMilestoneHist', 'planned_date'), 'а не transform DATE');
  assert.equal(ruleFor('KnowPR', 'pr_uid').rule, 'keep', 'соседние поля не задеты');
  const m = proposeMap({ KnowPR: { fields: [{ name: 'pr_id' }, { name: 'pr_uid' }] } });
  assert.equal(m.types.KnowPR.pr_id.legacy, true);
  assert.equal(m.types.KnowPR.pr_uid.legacy, undefined);
});

test('карты переноса: каждое поле списка, которое видела перепись, — по правилу легаси; лишних легаси нет', () => {
  const seen = [];
  for (const [T, t] of Object.entries(MAPS)) for (const [f, e] of Object.entries(t)) {
    if (!e || typeof e !== 'object' || !('rule' in e)) continue;
    const k = T + '.' + f;
    if (LEGACY.has(k)) { assert.deepEqual(e, legacyRule(T, f), k); seen.push(k); }
    else assert.notEqual(e.legacy, true, k + ': помечено легаси, но его нет в списке');
  }
  // В переписи 15–18.11 нет KnowUseCase.actor и KnowMilestoneHist.planned_date с данными — остальные обязаны быть в карте.
  const absent = [...LEGACY.keys()].filter(k => !seen.includes(k));
  assert.deepEqual(absent.filter(k => !['KnowUseCase.actor'].includes(k)), [], 'поле списка вне карты');
});

test('схема 1.18 (сборка из модели) не объявляет ни одного поля списка', () => {
  const left = [...LEGACY.keys()].filter(k => { const [T, f] = k.split('.'); return SCHEMA[T] && SCHEMA[T].fields[f]; });
  assert.deepEqual(left, []);
});

test('исполнитель карты: значение легаси-поля — в корзину legacy, не в новую запись; пустое — никуда', () => {
  const map = { pr_uid: { rule: 'keep', basis: 'owner' }, pr_id: legacyRule('KnowPR', 'pr_id'), repo: legacyRule('KnowPR', 'repo') };
  const r = applyMap('KnowPR', map, { pr_uid: 'AIDA/X#1', pr_id: 'PR-1', repo: '' });
  assert.deepEqual(r.out, { pr_uid: 'AIDA/X#1' });
  assert.deepEqual(r.legacy, { pr_id: 'PR-1' });
  assert.deepEqual(r.dropped, ['pr_id']);
  assert.deepEqual(applyMap('KnowPR', map, { pr_uid: 'u' }).legacy, {});
});

test('остаток: одна строка MigLeftover на значение, kind legacy_field, причина из правила', () => {
  const rows = legacyLeftovers('KnowPR', '#1:2', { legacy: { pr_id: 'PR-1', repo: 'aida' } });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { src_type: 'KnowPR', src_rid: '#1:2', field: 'pr_id', value: 'PR-1', kind: 'legacy_field', why: legacyRule('KnowPR', 'pr_id').why });
});

test('объявление убыли: «было» считается по исходной записи, независимо от исполнителя карты', () => {
  const acc = {};
  countLegacyBefore('KnowPR', { pr_id: 'PR-1', repo: '', pr_uid: 'u' }, acc);
  countLegacyBefore('KnowPR', { pr_id: 'PR-2', release_id: ['v1'] }, acc);
  countLegacyBefore('KnowPR', { pr_id: null, release_id: [] }, acc);
  countLegacyBefore('KnowSprint', { sprint_id: 'S' }, acc);
  assert.deepEqual(acc, { 'KnowPR.pr_id': 2, 'KnowPR.release_id': 1 });
});

test('сверка «было = остаток»: совпало — ok; расхождение — перенос останавливается с именами полей', () => {
  const left = [...legacyLeftovers('KnowPR', '#1:1', { legacy: { pr_id: 'a' } }), ...legacyLeftovers('KnowPR', '#1:2', { legacy: { pr_id: 'b' } }), { src_type: 'KnowPR', field: 'pr_id', kind: 'held' }];
  const ok = legacyDrop({ 'KnowPR.pr_id': 2 }, left);
  assert.equal(ok.ok, true);
  assert.equal(ok.fields['KnowPR.pr_id'].before, 2);
  assert.equal(ok.fields['KnowPR.pr_id'].leftover, 2);
  assert.equal(ok.fields['KnowPR.repo'].before, 0, 'каждое поле списка — в отчёте, даже пустое');
  assert.equal(ok.total.before, 2);
  assert.equal(ok.total.leftover, 2);
  assert.doesNotThrow(() => assertLegacyDrop(ok));
  const bad = legacyDrop({ 'KnowPR.pr_id': 3 }, left);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.mismatched, ['KnowPR.pr_id']);
  assert.throws(() => assertLegacyDrop(bad), /KnowPR\.pr_id: было 3, в остатке 2/);
});

test('конвейер переноса считает убыль, кладёт остаток legacy_field и сверяет приёмник', () => {
  const src = fs.readFileSync(new URL('./transfer.mjs', import.meta.url), 'utf8');
  assert.match(src, /countLegacyBefore\(T, rec, legacyBefore\)/);
  assert.match(src, /legacyLeftovers\(T, rid, res\)/);
  assert.match(src, /report\.legacy_drop = legacyDrop\(/);
  assert.match(src, /assertLegacyDrop\(report\.legacy_drop\)/);
  assert.match(src, /verify\.legacy_drop/);
});

test('MDL-08 ч.2: вторая пачка — KnowRelease.version (дубль git_tag) и KnowDoc.content_md (0 значений), своё слово владелицы', () => {
  assert.equal(LIST.more.length, 2);
  const b = LIST.more[0];
  assert.equal(b.basis, 'owner');
  assert.match(b.words, /тоже с релизами/);
  assert.deepEqual(Object.keys(b.fields), ['KnowDoc.content_md', 'KnowRelease.version']);
  assert.ok(LEGACY.has('KnowRelease.version') && LEGACY.has('KnowDoc.content_md'));
  assert.equal(LEGACY.size, 20);
  const r = legacyRule('KnowRelease', 'version');
  assert.equal(r.rule, 'drop');
  assert.equal(r.legacy, true);
  assert.match(r.why, /тоже с релизами/);
  assert.match(r.why, /git_tag/);
  assert.doesNotMatch(r.why, /мы же утвердили уже/, 'причина — слово своей пачки');
  assert.deepEqual(MAPS.KnowRelease.version, r);
  assert.deepEqual(MAPS.KnowDoc.content_md, legacyRule('KnowDoc', 'content_md'));
  assert.equal(SCHEMA.KnowRelease.fields.version, undefined);
  assert.equal(SCHEMA.KnowDoc.fields.content_md, undefined);
  assert.equal(MAPS.KnowRelease.title.rule, 'keep', 'title не дубль release_name — не снимается');
});

test('MDL-08 ч.3: KnowUserDraft.base_version — слово владелицы «а) снять base_version при переносе 1.18», заменено base_record_version', () => {
  assert.equal(LIST.more.length, 2);
  const b = LIST.more[1];
  assert.equal(b.basis, 'owner');
  assert.equal(b.approved, '2026-11-20');
  assert.equal(b.words, '«а) снять base_version при переносе 1.18»');
  assert.deepEqual(Object.keys(b.fields), ['KnowUserDraft.base_version']);
  const r = legacyRule('KnowUserDraft', 'base_version');
  assert.equal(r.rule, 'drop');
  assert.equal(r.legacy, true);
  assert.match(r.why, /^легаси, MDL-08, утверждено владелицей 20\.11\.2026: «а\) снять base_version при переносе 1\.18»; заменено base_record_version/);
  assert.deepEqual(MAPS.KnowUserDraft.base_version, r, 'карта переноса — по правилу легаси');
  assert.equal(MAPS.KnowUserDraft.base_record_version.rule, 'keep', 'новое поле переносится');
  assert.equal(SCHEMA.KnowUserDraft.fields.base_version, undefined, 'схема 1.18 поля не несёт');
  assert.ok(SCHEMA.KnowUserDraft.fields.base_record_version);
  // Значений 0 из 3 (перепись 18.11) — сверка тривиальна, но поле в отчёте есть: было 0 = остаток 0.
  const acc = {};
  for (const rec of [{ base_record_version: 'v1' }, { base_record_version: 'v2', base_version: null }, { base_record_version: 'v3' }])
    countLegacyBefore('KnowUserDraft', rec, acc);
  const rep = legacyDrop(acc, []);
  assert.deepEqual(rep.fields['KnowUserDraft.base_version'], { before: 0, leftover: 0 });
  assert.equal(rep.ok, true);
});
