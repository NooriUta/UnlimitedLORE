#!/usr/bin/env node
// Аудит ссылок на объекты LORE во всех MD-полях базы (SPRINT_UXR_POLISH_UAT_1113/PU-15).
//
// Только чтение: arcade.mjs пропускает лишь SELECT. Два шага, чтобы детерминизм был проверяемым:
//   1) снимок  — читает текущие версии MD-полей и справочник ID в JSON (сортированный);
//   2) отчёт   — строит HTML только из снимка; одинаковый снимок → байт-в-байт одинаковый отчёт.
//
// Запуск (PowerShell или bash):
//   node scripts/md-refs-audit/audit.mjs --env-file .env --host 192.168.3.143 --out <папка>
//   node scripts/md-refs-audit/audit.mjs --from <папка>/snapshot.json --out <папка>   (без БД)
// Пароль root берётся из ARCADEDB_ROOT_PASSWORD (окружение или --env-file), в вывод не попадает.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { connection, query } from './arcade.mjs';
import { classify, CLASSES } from './classify.mjs';
import { renderReport } from './report.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));

/** Поле ID у типа вершины: по нему записи называются в отчёте и проверяются ссылки. */
const ID_FIELD = {
  KnowTask: 'task_uid', KnowSprint: 'sprint_id', KnowADR: 'adr_id', KnowDecision: 'decision_id',
  KnowSpec: 'spec_id', KnowDoc: 'doc_id', KnowRunbook: 'runbook_id', LoreComponent: 'component_id',
  KnowRelease: 'release_id', KnowUseCase: 'uc_id', KnowQuestion: 'question_id', KnowPain: 'pain_id',
  KnowGain: 'gain_id', KnowJob: 'job_id', KnowProjectActor: 'actor_id', KnowActor: 'actor_id',
  KnowMilestone: 'milestone_id', KnowPhase: 'phase_uid', KnowFinding: 'finding_id', QualityGate: 'qg_id',
  KnowGitProject: 'name', KnowPR: 'pr_uid', QGRecommendation: 'rec_id', QGJobTask: 'job_id',
  PlanVersion: 'version_id', KnowUserDraft: 'ref_id', BragiPublication: 'publication_id', BragiInsight: 'insight_id', BragiVariant: 'variant_id', BragiChannel: 'channel_id',
  BragiRubric: 'rubric_id', BragiPage: 'page_id', ClRoutineRun: 'run_id', ClRoutineOutput: 'output_id',
};
/** Тип ссылки → вершина и поля, по которым запись находится. */
const REF_TARGETS = {
  task: ['KnowTask', ['task_uid']], sprint: ['KnowSprint', ['sprint_id']], adr: ['KnowADR', ['adr_id']],
  decision: ['KnowDecision', ['decision_id']], spec: ['KnowSpec', ['spec_id']], doc: ['KnowDoc', ['doc_id']],
  runbook: ['KnowRunbook', ['runbook_id']], component: ['LoreComponent', ['component_id']],
  release: ['KnowRelease', ['release_id', 'release_uid', 'git_tag']], uc: ['KnowUseCase', ['uc_id']],
  feature: ['KnowUseCase', ['uc_id']], question: ['KnowQuestion', ['question_id']], pain: ['KnowPain', ['pain_id']],
  gain: ['KnowGain', ['gain_id']], job: ['KnowJob', ['job_id']], actor: ['KnowProjectActor', ['actor_id']],
  agent_actor: ['KnowActor', ['actor_id']],
};
/** Прочие ID — только чтобы [[ID]] без типа узнавался как существующая запись. */
const EXTRA_IDS = [['BragiInsight', 'insight_id'], ['BragiPublication', 'publication_id'], ['QualityGate', 'qg_id'],
  ['QGJobTask', 'qg_id'], ['KnowFinding', 'finding_id'], ['KnowMilestone', 'milestone_id'], ['KnowPhase', 'phase_uid'],
  ['KnowGitProject', 'name'], ['KnowPR', 'pr_uid']];
const MD_FIELD = /(_md|_md_ru|_md_en)$|^(description|summary|statement|text)$/;

const sortStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function takeSnapshot(conn) {
  const types = (await query(conn, "select name, type from schema:types where type = 'vertex'"))
    .map((t) => t.name).sort(sortStr);
  const ids = {};
  for (const [ref, [vt, fields]] of Object.entries(REF_TARGETS)) {
    const set = new Set();
    for (const f of fields) for (const r of await query(conn, `select ${f} as v from ${vt} where ${f} is not null`)) set.add(String(r.v));
    ids[ref] = [...set].sort(sortStr);
  }
  const extraIds = new Set();
  for (const [vt, f] of EXTRA_IDS) {
    for (const r of await query(conn, `select ${f} as v from ${vt} where ${f} is not null`)) extraIds.add(String(r.v));
  }
  const codes = new Map();
  for (const r of await query(conn, 'select task_id from KnowTask where task_id is not null')) codes.set(r.task_id, (codes.get(r.task_id) ?? 0) + 1);

  const records = [];
  const vertexKeys = {};
  // Вершины: текущее значение лежит на самой вершине.
  for (const t of types.filter((x) => !x.endsWith('Hist'))) {
    const rows = await query(conn, `select from ${t}`);
    const keys = new Set();
    for (const row of rows) {
      Object.keys(row).forEach((k) => keys.add(k));
      const id = String(row[ID_FIELD[t]] ?? row['@rid']);
      for (const [k, v] of Object.entries(row)) {
        if (!MD_FIELD.test(k) || typeof v !== 'string' || !v.trim()) continue;
        records.push({ type: t, id, field: k, text: v, ownerSprint: ownerSprint(t, id) });
      }
    }
    vertexKeys[t] = keys;
  }
  // *Hist: только открытая версия (valid_to is null) и только поля, которых нет на вершине.
  for (const h of types.filter((x) => x.endsWith('Hist'))) {
    const owner = h.slice(0, -4);
    const idf = ID_FIELD[owner];
    const probe = await query(conn, `select from ${h} limit 1`);
    if (!probe.length || !('valid_to' in probe[0])) continue; // без SCD2-окна (KnowDocHist) — текущее на вершине
    const rows = await query(conn, `select *, in('HAS_STATE')[0].${idf ?? '@rid'} as __owner from ${h} where valid_to is null`);
    for (const row of rows) {
      const id = String(row.__owner ?? row['@rid']);
      for (const [k, v] of Object.entries(row)) {
        if (!MD_FIELD.test(k) || typeof v !== 'string' || !v.trim()) continue;
        if (vertexKeys[owner]?.has(k)) continue;
        records.push({ type: owner, id, field: k, text: v, ownerSprint: ownerSprint(owner, id), via: h });
      }
    }
  }
  records.sort((a, b) => sortStr(a.type, b.type) || sortStr(a.id, b.id) || sortStr(a.field, b.field) || sortStr(a.text, b.text));
  return {
    source: { host: conn.host, port: conn.port, db: conn.db },
    ids, extraIds: [...extraIds].sort(sortStr), taskCodes: [...codes.entries()].sort((a, b) => sortStr(a[0], b[0])), records,
  };
}

function ownerSprint(type, id) {
  if (type === 'KnowSprint') return id;
  if ((type === 'KnowTask' || type === 'KnowPhase') && id.includes('/')) return id.split('/')[0];
  return null;
}

export function analyse(snap) {
  const ids = Object.fromEntries(Object.entries(snap.ids).map(([k, v]) => [k, new Set(v)]));
  const taskCodes = new Map(snap.taskCodes);
  const all = new Set([...Object.values(snap.ids).flat(), ...(snap.extraIds ?? [])]);
  const anyId = (x) => all.has(x);
  const mentions = [];
  for (const r of snap.records) {
    for (const m of classify(r.text, { ids, taskCodes, anyId, ownerSprint: r.ownerSprint })) {
      mentions.push({ ...m, recType: r.type, recId: r.id, field: r.field });
    }
  }
  return { mentions, records: snap.records, controls: liveControls(mentions) };
}

/**
 * Положительный контроль на живых записях: заведомо правильные и заведомо неправильные
 * ссылки, найденные глазами 13.11.2026. Если запись поправят — строка станет «НЕ узнал»
 * и это будет видно, а не спрятано.
 */
const LIVE_CONTROLS = [
  ['KnowSpec', 'SPEC-LORE-MD-INLINE-REF', 'content_md', 'ADR-LORE-050', 'wiki_bare', false, 'канон [[ID]], запись есть'],
  ['KnowSpec', 'SPEC-ADMIN-SETUP-MAP', 'content_md', 'SPRINT_LORE_ADMIN_PANEL/AL-84', 'wiki_typed', false, 'канон [[task:…]], запись есть'],
  ['KnowTask', 'SPRINT_MINILORE_DEEP_ARCHIVE/DA-7', 'note_md', 'SPRINT_MINILORE_DEEP_ARCHIVE/DA-2', 'typed', false, 'канон task:СПРИНТ/КОД'],
  ['KnowTask', 'SPRINT_MIDGARD_KORVO/KV-18', 'note_md', 'SPRINT_MIDGARD_KORVO/KV-08', 'shape', false, 'канон по виду СПРИНТ/КОД'],
  ['KnowTask', 'SPRINT_LORE_PRODUCT_LAYER/SRCH-06B', 'note_md', 'ADR-LORE-033-D14', 'wiki_bare', 'wrong:decision', '[[ID]] вида ADR, а запись — решение'],
  ['KnowTask', 'SPRINT_LORE_MOBILE_UX/MOB-14', 'note_md', 'feedback_ux_change_process', null, 'explicit', 'битая: дока с таким ID нет (это файл памяти агента)'],
  ['KnowTask', 'SPRINT_LLM_DIALECT_GUARD/DG-17', 'note_md', 'DG-16', 'lone_task', undefined, 'одинокий код задачи'],
  ['KnowTask', 'SPRINT_AIDA_PREPROD_MIGRATION/AID-42', 'note_md', 'AID-41', 'lone_task_wiki', undefined, 'одинокий код в [[…]]'],
  ['KnowRelease', 'v1.11.0', 'description_md', 'SPRINT_LORE_ROADMAP_PER_PROJECT/RM-P18', 'backtick', undefined, 'ID в обратных кавычках'],
  ['KnowTask', 'SPRINT_GEOID_STRUCTURAL_ID/B5', 'note_md', null, 'url_lore', undefined, 'URL экрана :4400/lore?…'],
  ['KnowTask', 'SPRINT_ARCH_HOUSEKEEPING/AHK-09', 'note_md', null, 'url_github', undefined, 'GitHub-ссылка на PR'],
  ['KnowTask', 'SPRINT_GJALLARHORN_NET_AUDIO/NA-25', 'note_md', 'SPRINT_GJALLARHORN_NET_AUDIO/NA-23', 'wiki_escaped', undefined, 'экранированная \\[\\[…\\]\\]'],
];

function liveControls(mentions) {
  return LIVE_CONTROLS.map(([recType, recId, field, id, cls, broken, expectTitle]) => {
    const mine = mentions.filter((m) => m.recType === recType && m.recId === recId && m.field === field);
    const brokenOk = (m) => (broken === undefined ? true
      : String(broken).startsWith('wrong:') ? m.wrongType === broken.slice(6)
      : (m.broken ?? false) === broken);
    const hit = mine.find((m) => (cls == null || m.cls === cls) && (id == null || m.id === id) && brokenOk(m));
    const sameId = mine.filter((m) => id != null && m.id === id).map((m) => m.cls + (m.broken ? `/${m.broken}` : ''));
    const got = !mine.length ? 'запись/поле не найдено в снимке'
      : hit ? `${hit.cls}${hit.broken ? `/${hit.broken}` : ''}${hit.wrongType ? `/на деле ${hit.wrongType}` : ''}: ${hit.id}`
      : (sameId.length ? sameId.join(', ') : `нет класса ${cls}`);
    return { recType, recId, field, id: id ?? '(URL)', expectTitle, ok: !!hit, got };
  });
}

async function main() {
  // По умолчанию — вне репо: снимок содержит тексты прод-базы и коммитить его нельзя.
  const out = path.resolve(args.out ?? path.join(os.tmpdir(), 'lore-md-refs-audit'));
  fs.mkdirSync(out, { recursive: true });
  let snap;
  if (args.from) {
    snap = JSON.parse(fs.readFileSync(args.from, 'utf8'));
  } else {
    if (args.host) process.env.ARCADE_HOST = args.host;
    if (args.db) process.env.ARCADE_DB = args.db;
    const conn = connection({ envFile: args['env-file'] });
    snap = await takeSnapshot(conn);
    fs.writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify(snap));
  }
  const inputHash = crypto.createHash('sha256').update(JSON.stringify(snap)).digest('hex');
  const res = analyse(snap);
  const html = renderReport({ snap, ...res, inputHash, classes: CLASSES });
  const file = path.join(out, args.name ?? 'md-refs-audit.html');
  fs.writeFileSync(file, html);
  const outHash = crypto.createHash('sha256').update(html).digest('hex');
  const failed = res.controls.filter((c) => !c.ok);
  console.log(JSON.stringify({ records: snap.records.length, mentions: res.mentions.length,
    controls: `${res.controls.length - failed.length}/${res.controls.length}`, inputHash, reportHash: outHash, file }));
  for (const c of failed) console.error(`КОНТРОЛЬ НЕ ПРОШЁЛ: ${c.expectTitle} — ${c.recId} ${c.field}: ${c.got}`);
}

if (process.argv[1]?.endsWith("audit.mjs")) {
  main().catch((e) => { console.error('ОШИБКА:', e.message); process.exit(1); });
}
