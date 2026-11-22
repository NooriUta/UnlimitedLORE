// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 / MIG-02 — задачи без спринта: шаг мастера переноса.
// Владелица 19.11.2026: «без спринта реконструировать ребро в визарде предложить владельцу привязать».
// Перепись источника migration_src_2026_11_18: 12 задач без ребра PART_OF. Установщик предлагает, решает человек.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { proposeOrphanSprints, orphanSprintAnswers, withOrphanSprints, orphanSprintState } from './orphan-sprints.mjs';

// Реестр и задачи — по образцу источника 18.11.2026.
const SPRINTS = ['SPRINT_MIGGEN_PIPELINE', 'SPRINT_MIG_GEN_PYTHON', 'SPRINT_MOBILEPOC_MVP', 'SPRINT_HOUND_OBJECT_DEDUP', 'SPRINT_HOUND_S3', 'SPRINT_AIDA_PREPROD_MIGRATION', 'SPRINT_LORE_MODEL_DOCS_TIDY'];
const TASKS = [
  { task_uid: 'MIGGEN_PIPELINE/PRINT-ONE-PARSE', task_id: 'PRINT-ONE-PARSE' },
  { task_uid: 'MOBILEPOC/UX-SERVER-PROBE', task_id: 'UX-SERVER-PROBE' },
  { task_uid: 'SPRINT_AIDA_INFRA_DEBT/AID-44', task_id: 'AID-44' },
  { task_uid: 'BACKLOG_HOUND_OBJECT_DEDUP', task_id: 'BACKLOG_HOUND_OBJECT_DEDUP' },
  { task_uid: 'ZZZ/Q-1', task_id: 'Q-1' },
];
const BY_CODE = new Map([['AID-44', ['SPRINT_AIDA_PREPROD_MIGRATION/AID-44']]]);
const row = (r, uid) => r.find(x => x.task_uid === uid);

test('предложение: приставка = спринт реестра (с SPRINT_ впереди) — точно', () => {
  const r = proposeOrphanSprints({ tasks: TASKS, sprints: SPRINTS, uidsByCode: BY_CODE });
  const x = row(r, 'MIGGEN_PIPELINE/PRINT-ONE-PARSE');
  assert.equal(x.kind, 'exact');
  assert.equal(x.sprint, 'SPRINT_MIGGEN_PIPELINE');
  assert.match(x.why, /реестр/);
});

test('предложение: похожий спринт — «похоже, подтвердите»', () => {
  const r = proposeOrphanSprints({ tasks: TASKS, sprints: SPRINTS, uidsByCode: BY_CODE });
  assert.equal(row(r, 'MOBILEPOC/UX-SERVER-PROBE').kind, 'similar');
  assert.equal(row(r, 'MOBILEPOC/UX-SERVER-PROBE').sprint, 'SPRINT_MOBILEPOC_MVP');
  assert.match(row(r, 'MOBILEPOC/UX-SERVER-PROBE').why, /похоже, подтвердите/);
  const h = row(r, 'BACKLOG_HOUND_OBJECT_DEDUP');
  assert.equal(h.kind, 'similar');
  assert.equal(h.sprint, 'SPRINT_HOUND_OBJECT_DEDUP', 'больше общих слов — HOUND_OBJECT_DEDUP, а не HOUND_S3');
});

test('предложение: задача с тем же кодом в другом спринте — «возможен дубль»', () => {
  const r = proposeOrphanSprints({ tasks: TASKS, sprints: SPRINTS, uidsByCode: BY_CODE });
  const x = row(r, 'SPRINT_AIDA_INFRA_DEBT/AID-44');
  assert.equal(x.kind, 'duplicate');
  assert.equal(x.duplicate_of, 'SPRINT_AIDA_PREPROD_MIGRATION/AID-44');
  assert.equal(x.sprint, 'SPRINT_AIDA_PREPROD_MIGRATION');
  assert.match(x.why, /возможен дубль/);
});

// Репетиция 19.11.2026: MOBILEPOC/UX-SERVER-PROBE — и «возможен дубль» (SPRINT_MINILORE_UX/UX-SERVER-PROBE),
// и похожий спринт SPRINT_MOBILEPOC_MVP. Дубль сильнее, но похожий спринт показывается рядом — выбирает человек.
test('предложение: при «возможен дубль» похожий спринт тоже в кандидатах и в основании', () => {
  const by = new Map([['UX-SERVER-PROBE', ['SPRINT_MINILORE_UX/UX-SERVER-PROBE']]]);
  const [x] = proposeOrphanSprints({ tasks: [{ task_uid: 'MOBILEPOC/UX-SERVER-PROBE', task_id: 'UX-SERVER-PROBE' }], sprints: [...SPRINTS, 'SPRINT_MINILORE_UX'], uidsByCode: by });
  assert.equal(x.kind, 'duplicate');
  assert.deepEqual(x.candidates, ['SPRINT_MINILORE_UX', 'SPRINT_MOBILEPOC_MVP']);
  assert.match(x.why, /похожий спринт по коду — SPRINT_MOBILEPOC_MVP/);
});

test('предложение: ничего не нашлось — «куда?»; порядок по task_uid и не зависит от порядка строк', () => {
  const r = proposeOrphanSprints({ tasks: TASKS, sprints: SPRINTS, uidsByCode: BY_CODE });
  assert.equal(row(r, 'ZZZ/Q-1').kind, 'where');
  assert.equal(row(r, 'ZZZ/Q-1').sprint, null);
  const back = proposeOrphanSprints({ tasks: [...TASKS].reverse(), sprints: [...SPRINTS].reverse(), uidsByCode: BY_CODE });
  assert.deepEqual(back, r);
});

test('ответы: пишутся с кем и когда; спринт, «без спринта» (null) или дубль; без ответа — ждёт решения', () => {
  assert.throws(() => withOrphanSprints({}, { A: 'S' }, ''), /кто принял/);
  const doc = withOrphanSprints({ format: 'mig-decisions/1' }, { 'M/1': 'SPRINT_M', 'Z/2': null, 'A/44': { duplicate_of: 'S/44' } }, 'omiloreadmin', '2026-11-19T21:00:00Z');
  assert.equal(doc.orphan_sprints.by, 'omiloreadmin');
  assert.equal(doc.orphan_sprints.at, '2026-11-19T21:00:00Z');
  const st = orphanSprintState([{ task_uid: 'M/1' }, { task_uid: 'Z/2' }, { task_uid: 'A/44' }, { task_uid: 'W/9' }], orphanSprintAnswers(doc));
  assert.deepEqual(st, { link: [{ task_uid: 'M/1', sprint: 'SPRINT_M' }], duplicate: [{ task_uid: 'A/44', of: 'S/44' }], keep: ['Z/2'], waiting: ['W/9'] });
});

test('ответов владелицы в файле решений репозитория нет: она подтверждает их в мастере', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('./rules/decisions.lore.json', import.meta.url), 'utf8'));
  assert.equal(doc.orphan_sprints, undefined);
});

test('перенос и мастер: ребро — только по ответу, дубль — в остаток, шаг «З» в мастере', () => {
  const tr = fs.readFileSync(new URL('./transfer.mjs', import.meta.url), 'utf8');
  assert.match(tr, /orphanSprintState\(/);
  assert.match(tr, /kind: 'merged_duplicate'/);
  const te = fs.readFileSync(new URL('./transfer-edges.mjs', import.meta.url), 'utf8');
  assert.match(te, /applyOrphanSprints\(/);
  assert.match(te, /hsKept/, 'ожидаемое число связей версий — по записям, которые есть в приёмнике');
  const ui = fs.readFileSync(new URL('./ui.mjs', import.meta.url), 'utf8');
  assert.match(ui, /data-step="o"/);
  assert.match(ui, /api\/orphan-sprints/);
});

// 1.18.3 · Шаг «З» живым мастером — проверка переехала из стендового смоука (кейс MA7). На стенде мастера
// нет и не будет: он поднимается установщиком, а переменную LORE_MIGRATE_UI_URL владелица решила не
// заводить — там кейс вечно висел «не выполнено» и ронял смоук. Проверяем то же, что проверял MA7: у каждой
// строки вид предложения и непустое основание, состояние «ждут решения» показано, ответ его уменьшает, а
// ответ без «кто принял» — честный отказ. Источник — заглушка в памяти (как decision-refs-wizard.test.mjs).
const SRC = {
  loose: [
    { task_uid: 'MIGGEN_PIPELINE/PRINT-ONE-PARSE', task_id: 'PRINT-ONE-PARSE', title: 'Разбор печати', status_raw: 'в работе' },
    { task_uid: 'MOBILEPOC/UX-SERVER-PROBE', task_id: 'UX-SERVER-PROBE', title: 'Проба сервера', status_raw: 'готово' },
    { task_uid: 'SPRINT_AIDA_INFRA_DEBT/AID-44', task_id: 'AID-44', title: 'Долг инфраструктуры', status_raw: 'готово' },
    { task_uid: 'ZZZ/Q-1', task_id: 'Q-1', title: 'Ничейная', status_raw: 'план' },
  ],
  linked: [{ task_uid: 'SPRINT_AIDA_PREPROD_MIGRATION/AID-44', task_id: 'AID-44' }],
  sprints: ['SPRINT_MIGGEN_PIPELINE', 'SPRINT_MOBILEPOC_MVP', 'SPRINT_AIDA_PREPROD_MIGRATION', 'SPRINT_LORE_MODEL_DOCS_TIDY'],
};

/** Источник в памяти: отвечает ровно на запросы readOrphanSprintInput. */
function orphanFixture() {
  return {
    env: { MIG_SRC_DB: 'fixture-orphan-sprints', MIG_DST_DB: 'fixture-dst' },
    async src(sql) {
      if (/FROM KnowSprint/.test(sql)) return SRC.sprints.map(s => ({ sprint_id: s }));
      if (/PART_OF'\)\.size\(\) = 0/.test(sql)) return SRC.loose.map(x => ({ ...x }));
      if (/PART_OF'\)\.size\(\) > 0/.test(sql)) return SRC.linked.map(x => ({ ...x }));
      throw new Error('заглушка источника: запрос не поддержан: ' + sql.slice(0, 80));
    },
  };
}

test('мастер установщика, шаг «З»: у каждой строки предложение с основанием, «ждут решения» показано и убывает (было MA7 смоука)', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const { serve } = await import('./ui.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-os-'));
  const file = path.join(dir, 'decisions.json');
  const server = await serve({ port: 0, db: orphanFixture(), decisionsFile: file });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await (await fetch(base + '/')).text();
    assert.match(page, /data-step="o"[^>]*>.*Задачи без спринта/, 'шаг «З» есть в мастере');
    assert.match(page, /data-testid="os-state"/, 'состояние «ждут решения» показано, не молча');
    for (const w of ['точно', 'похоже, подтвердите', 'возможен дубль', 'куда?'])
      assert.ok(page.includes(w), `вид предложения «${w}» назван словами`);

    const g = await (await fetch(base + '/api/orphan-sprints')).json();
    assert.equal(g.rows.length, SRC.loose.length, 'строки шага прочитаны (не «честная ошибка чтения»)');
    for (const r of g.rows) {
      assert.ok(['exact', 'duplicate', 'similar', 'where'].includes(r.kind), `вид предложения у ${r.task_uid}: ${r.kind}`);
      assert.ok(String(r.why).length > 10, `основание не пустое у ${r.task_uid}`);
    }
    assert.equal(g.waiting.length, g.rows.length, 'без ответов ждут решения все строки');

    const target = g.rows.find(r => r.kind === 'exact');
    assert.ok(target, 'строка «точно» есть — её и принимаем');
    const post = await fetch(base + '/api/orphan-sprints', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ map: { [target.task_uid]: target.sprint }, by: 'node-test' }) });
    assert.equal(post.status, 200);
    const g2 = await (await fetch(base + '/api/orphan-sprints')).json();
    assert.equal(g2.waiting.length, g.waiting.length - 1, '«ждут решения» уменьшилось на одну строку');
    assert.equal(g2.answers[target.task_uid], target.sprint, 'ответ записан в файл решений');
    assert.equal(g2.by, 'node-test', 'кто принял — рядом с ответом');

    const bad = await fetch(base + '/api/orphan-sprints', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ map: { 'ZZZ/Q-1': 'SPRINT_LORE_MODEL_DOCS_TIDY' }, by: '' }) });
    assert.equal(bad.status, 400, 'без «кто принял» — отказ, а не тихая запись');
    assert.equal((await (await fetch(base + '/api/orphan-sprints')).json()).waiting.length, g2.waiting.length);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
