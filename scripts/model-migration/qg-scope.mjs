import { splitGaps, gapLine, strictMode } from './source-gap.mjs';

// SPRINT_QG_REBUILD/QG-01 · Охват гейта (scope) при переносе 1.18. Решение владелицы 19.11.2026 «2а 3а»
// (D-2026-MIG-118-OWNER-ANSWERS-1119): у гейта явный признак scope = global | project; четыре гейта гигиены данных LORE —
// общие (global) и без проекта; остальные гейты с проектом — project; старый смоук QG-T13-SMOKE — снять (retired с причиной).
// Правило — rules/qg-scope.json; шаг идёт после переноса связей, поэтому проектные связи общих гейтов снимаются
// в приёмнике (источник только читается) и называются в отчёте. Повторный перенос даёт тот же итог.

/**
 * План по гейтам источника: [{ qg_id, status, projects: [slug] }] и правилу { global: [qg_id], retire: { qg_id: причина } }.
 * problems — отклонения с видом: rule_gate_missing (гейт правила не найден), no_project (не общий, не снят, без проекта),
 * many_projects (проектный гейт обязан иметь ровно один проект).
 */
export function planQgScope(gates, rule) {
  const glob = new Set(rule.global || []), retire = rule.retire || {};
  const ids = new Set(gates.map(g => g.qg_id));
  const scope = {}, dropProjectLinks = [], retired = [], problems = [];
  for (const id of [...glob, ...Object.keys(retire)]) if (!ids.has(id)) problems.push({ qg_id: id, kind: 'rule_gate_missing' });
  for (const g of gates) {
    const projects = g.projects || [];
    if (retire[g.qg_id]) { retired.push({ qg_id: g.qg_id, reason: retire[g.qg_id] }); continue; }
    if (glob.has(g.qg_id)) {
      scope[g.qg_id] = 'global';
      if (projects.length) dropProjectLinks.push(g.qg_id);
      continue;
    }
    if (!projects.length) { problems.push({ qg_id: g.qg_id, kind: 'no_project' }); continue; }
    if (projects.length > 1) problems.push({ qg_id: g.qg_id, kind: 'many_projects' });
    scope[g.qg_id] = 'project';
  }
  const n = v => Object.values(scope).filter(s => s === v).length;
  return { scope, dropProjectLinks, retire: retired, problems,
    counts: { global: n('global'), project: n('project'), retired: retired.length, project_links_dropped: dropProjectLinks.length } };
}

/** Гейты источника: код, статус и проекты (только чтение). */
export async function readQgScopeInput(db) {
  const rows = await db.src("SELECT qg_id, status, out('BELONGS_TO_PROJECT').slug AS projects FROM QualityGate ORDER BY qg_id");
  return rows.map(r => ({ qg_id: r.qg_id, status: r.status, projects: (Array.isArray(r.projects) ? r.projects : []).filter(Boolean) }));
}

/**
 * Применить план в приёмнике и сверить «после»: у общих scope=global и ни одной связи с проектом, у проектных
 * scope=project, снятые — retired с причиной; гейт без охвата (не снятый) — сверка не сходится.
 */
export async function applyQgScope(db, gates, rule, { log = console.log } = {}) {
  const p = planQgScope(gates, rule);
  await db.dstCommand('CREATE PROPERTY QualityGate.scope IF NOT EXISTS STRING');
  for (const [id, s] of Object.entries(p.scope)) await db.dstCommand('UPDATE QualityGate SET scope = :s WHERE qg_id = :id', { s, id });
  let dropped = 0;
  if (p.dropProjectLinks.length) {
    const edges = await db.dstQuery("SELECT @rid AS r FROM BELONGS_TO_PROJECT WHERE @out.@type = 'QualityGate' AND @out.qg_id IN :ids", { ids: p.dropProjectLinks });
    for (const e of edges) { await db.dstCommand(`DELETE FROM ${e.r}`); dropped++; }
  }
  for (const r of p.retire) await db.dstCommand("UPDATE QualityGate SET status = 'retired', retired_reason = :r WHERE qg_id = :id", { r: r.reason, id: r.qg_id });

  const got = await db.dstQuery("SELECT qg_id, status, scope, retired_reason, out('BELONGS_TO_PROJECT').slug AS projects FROM QualityGate");
  const proj = g => (Array.isArray(g.projects) ? g.projects : []).filter(Boolean);
  const after = {
    global: got.filter(g => g.scope === 'global').length,
    project: got.filter(g => g.scope === 'project').length,
    retired: got.filter(g => g.status === 'retired' && g.retired_reason).length,
    global_with_project: got.filter(g => g.scope === 'global' && proj(g).length).length,
    unscoped: got.filter(g => !g.scope && g.status !== 'retired').length,
  };
  const written = after.global === p.counts.global && after.project === p.counts.project
    && after.global_with_project === 0 && after.unscoped === 0 && dropped >= p.counts.project_links_dropped
    && p.retire.every(r => got.some(g => g.qg_id === r.qg_id && g.status === 'retired'));
  const v = judgeQgScope({ ok: written, problems: p.problems });
  log(`охват гейтов: общих ${after.global}, проектных ${after.project}, снято ${after.retired}; снято связей общих гейтов с проектом ${dropped}`
    + (v.mismatch.length ? '; отклонения: ' + v.mismatch.map(x => x.qg_id + ' ' + x.kind).join(', ') : '') + v.line);
  log('сверка охвата гейтов:', v.ok ? 'сошлась' : 'НЕ сошлась');
  return { ok: v.ok, decision: rule.decision || null, plan: p.counts, after, project_links_dropped: dropped, problems: p.problems,
    scope: p.scope, retired: p.retire.map(r => r.qg_id), absent_in_source: v.absent };
}

/**
 * Вердикт шага. Два вида «делать нечего» установку НЕ роняют, но называются поимённо:
 * <ul>
 *   <li>{@code rule_gate_missing} — правило называет гейт, которого в источнике нет (база старше правила:
 *       на бэкапе до 1.18 гейтов гигиены ещё не существовало);</li>
 *   <li>{@code no_project} — у гейта нет проекта, и охват ему задать нечем. Запись при этом верна: гейт остаётся
 *       без охвата, в отчёте он в {@code after.unscoped}. Правка 22.11.2026 по прогону на чужой машине: раньше
 *       это было красным «всегда», и перенос снимка нашего прода объявлял «НЕ сошлась» из-за 20 таких гейтов,
 *       ничего не записав неправильно — у человека это выглядело бы как сломанная установка.</li>
 * </ul>
 * Красным остаётся {@code many_projects} — охват неоднозначен, тут выбор за человеком. В строгом режиме
 * ({@code LORE_MIGRATE_STRICT=1}, наша труба на свежем снимке) красным становится и то и другое: у нас гейт без
 * проекта — настоящая дыра в данных.
 */
export function judgeQgScope({ ok, problems = [] }, { strict = strictMode() } = {}) {
  const g = splitGaps(problems, ['rule_gate_missing', 'no_project'], { strict });
  return {
    ok: ok && g.blocking.length === 0,
    absent: g.absent,
    mismatch: g.mismatch,
    line: gapLine(g.absent, x => x.kind === 'no_project'
      ? `${x.qg_id} (у гейта нет проекта — охват не задан)`
      : `${x.qg_id} (гейта нет в источнике)`,
      'охват задать нечему (пропущено, не ошибка)'),
  };
}
