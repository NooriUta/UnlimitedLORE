// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Шаг мастера «Ожидание → связи» (Ж): текст waiting_for задачи («чьего ответа
// ждём»), на проде 16.11 — 47 открытых версий. Владелица 20.11.2026: «ок связь где можно где нет текст».
//   - текст однозначно называет запись ПЛАНИРОВАНИЯ из реестра этой установки — задачу (SPRINT_X/CODE), фазу
//     (SPRINT_X/PHASE_…), спринт, веху; формы: голый код, [[код]], [[тип:код]], тип:код — предлагается связь
//     DEPENDS_ON задача → запись вида WAIT_KIND с причиной = исходный текст;
//   - называет ADR, решение, спеку, вопрос — это не планирование: связь «зависит от» их не соединяет, остаётся текстом;
//   - не называет ничего — остаётся текстом;
//   - статус задачи сейчас не «ждём» — адресат остался от прошлого статуса (прод 16.11: 33 таких), связь не
//     предлагается, текст остаётся.
// Решает человек: группой («принять все») или по одной; ответ — раздел waiting_links файла решений:
// { map: { task_uid: true | false }, by, at }. Без ответа — текстом, «ждёт решения». Текст поля не стирается никогда.

export const WAIT_KIND = 'waits';
export const RULE = 'waiting-for';

const TYPED = /\b(task|phase|sprint|milestone|adr|decision|spec|question|doc):([A-Za-z0-9_.\/-]+)/gi;
const WIKI = /\[\[([^\]]+)\]\]/g;
const UID = /\b(SPRINT_[A-Z0-9_]+)\/([A-Za-z0-9_.-]+)/g;
const SPRINT = /\bSPRINT_[A-Z0-9_]+\b(?!\/)/g;
const OTHER = /\b(ADR-[A-Z0-9-]+|D-\d{4}-[A-Z0-9-]+|SPEC-[A-Z0-9-]+|Q-[A-Z0-9-]+)\b/g;

/** Записи планирования, названные в тексте и найденные в реестре; прочие коды LORE — в other. */
export function refsIn(text, reg) {
  const t = String(text || '');
  const sets = { task: new Set(reg.tasks), phase: new Set(reg.phases), sprint: new Set(reg.sprints), milestone: new Set(reg.milestones) };
  const targets = [], other = [], seen = new Set();
  const put = (type, id) => { const k = type + ':' + id; if (seen.has(k)) return; seen.add(k); targets.push({ type, id }); };
  const typeOf = id => (sets.task.has(id) ? 'task' : sets.phase.has(id) ? 'phase' : sets.sprint.has(id) ? 'sprint' : sets.milestone.has(id) ? 'milestone' : null);
  const cands = [];
  for (const m of t.matchAll(WIKI)) cands.push({ at: m.index, id: m[1].replace(/^(task|phase|sprint|milestone|adr|decision|spec|question|doc):/i, '').trim() });
  for (const m of t.matchAll(TYPED)) cands.push({ at: m.index, id: m[2] });
  for (const m of t.matchAll(UID)) cands.push({ at: m.index, id: m[0] });
  for (const m of t.matchAll(SPRINT)) cands.push({ at: m.index, id: m[0] });
  for (const m of t.matchAll(OTHER)) cands.push({ at: m.index, id: m[0], other: true });
  // «[[M-1]]» ловится и как вики, и (частично) регулярками — порядок по месту в тексте, дубли отсекаются
  cands.sort((a, b) => a.at - b.at);
  for (const c of cands) {
    const ty = typeOf(c.id);
    if (ty) put(ty, c.id);
    else if (c.other || /^(ADR|D|SPEC|Q)-/.test(c.id)) { if (!other.includes(c.id)) other.push(c.id); }
  }
  // спринт, названный только как приставка кода задачи, — не отдельная цель
  const uids = targets.filter(x => x.type !== 'sprint').map(x => x.id);
  return { targets: targets.filter(x => !(x.type === 'sprint' && uids.some(u => u.startsWith(x.id + '/') && !t.replace(new RegExp(x.id + '/', 'g'), '').includes(x.id)))), other };
}

const isWaiting = s => /WAIT|ЖД[ЁЕ]М|ОЖИДА/i.test(String(s || ''));

/** Предложения по версиям задач: rows [{task_uid, waiting_for, status_raw, valid_from}], reg — реестр установки. */
export function proposeWaitingLinks(rows, reg) {
  return [...rows].sort((a, b) => String(a.task_uid).localeCompare(String(b.task_uid))).map(r => {
    const base = { task_uid: r.task_uid, text: r.waiting_for, status_raw: r.status_raw || null, valid_from: r.valid_from || null };
    if (!isWaiting(r.status_raw)) return { ...base, kind: 'stale', targets: [], why: 'статус задачи сейчас не «ждём» — адресат остался от прошлого статуса; остаётся текстом' };
    const { targets, other } = refsIn(r.waiting_for, reg);
    const ts = targets.filter(x => !(x.type === 'task' && x.id === r.task_uid));
    if (ts.length) return { ...base, kind: 'link', targets: ts, reason: r.waiting_for, why: `в тексте названо: ${ts.map(x => x.type + ':' + x.id).join(', ')} — связь «зависит от» вида ${WAIT_KIND}, причина — текст` };
    if (other.length) return { ...base, kind: 'text', targets: [], why: `названо ${other.join(', ')} — не планирование: связь «зависит от» соединяет задачу, фазу, спринт и веху; остаётся текстом` };
    return { ...base, kind: 'text', targets: [], why: 'запись LORE в тексте не названа — остаётся текстом' };
  });
}

export function waitingLinkAnswers(doc) {
  const m = doc && doc.waiting_links && typeof doc.waiting_links === 'object' ? doc.waiting_links.map || {} : {};
  return Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'boolean'));
}

export function withWaitingLinks(doc, map, by, at = new Date().toISOString()) {
  if (!by) throw new Error('не записано: не сказано, кто принял');
  const next = { ...waitingLinkAnswers(doc) };
  for (const [k, v] of Object.entries(map || {})) {
    if (typeof v !== 'boolean') throw new Error(`ответ по ${k} — true или false (связь / оставить текстом)`);
    next[k] = v;
  }
  return { ...doc, waiting_links: { map: next, by, at } };
}

/** Итог: какие связи поставить; счёт — сколько текстов, сколько стало связями, сколько осталось текстом, ждёт решения. */
export function waitingLinkState(proposals, answers) {
  const links = [];
  let became = 0, waiting = 0;
  for (const p of proposals) {
    if (p.kind !== 'link') continue;
    const a = answers[p.task_uid];
    if (a === undefined) { waiting++; continue; }
    if (!a) continue;
    became++;
    for (const t of p.targets) links.push({ task_uid: p.task_uid, target: t, reason: p.reason, valid_from: p.valid_from });
  }
  return { links, counts: { texts_with_waiting_for: proposals.length, proposed: proposals.filter(p => p.kind === 'link').length,
    became_links: became, edges: links.length, stayed_text: proposals.length - became, waiting,
    stale: proposals.filter(p => p.kind === 'stale').length, not_planning_or_no_ref: proposals.filter(p => p.kind === 'text').length } };
}

/** Чтение: текущие версии задач с waiting_for и реестр записей планирования. q — запрос к базе. */
export async function readWaitingLinkInput(q) {
  const rows = (await q("SELECT in('HAS_STATE').task_uid[0] AS task_uid, waiting_for, status_raw, valid_from FROM KnowTaskHist WHERE valid_to IS NULL AND waiting_for IS NOT NULL AND waiting_for <> ''"))
    .filter(r => r.task_uid);
  const col = async (T, f) => (await q(`SELECT ${f} AS v FROM ${T}`)).map(x => x.v).filter(Boolean);
  return { rows, reg: { tasks: await col('KnowTask', 'task_uid'), phases: await col('KnowPhase', 'phase_uid'), sprints: await col('KnowSprint', 'sprint_id'), milestones: await col('KnowMilestone', 'milestone_id') } };
}

/**
 * Шаг связей: рёбра DEPENDS_ON задача → запись по принятым ответам (вид WAIT_KIND, причина — текст, valid_from — момент
 * версии задачи, mig_rule — RULE). Пара, у которой текущая связь уже есть, не дублируется. Сверка — число рёбер.
 */
export async function applyWaitingLinks(db, doc, { log = console.log, at } = {}) {
  const input = await readWaitingLinkInput(q => db.src(q));
  const st = waitingLinkState(proposeWaitingLinks(input.rows, input.reg), waitingLinkAnswers(doc));
  const V = { task: ['KnowTask', 'task_uid'], phase: ['KnowPhase', 'phase_uid'], sprint: ['KnowSprint', 'sprint_id'], milestone: ['KnowMilestone', 'milestone_id'] };
  const ridOf = async (type, id) => { const [T, k] = V[type]; const r = await db.dstQuery(`SELECT @rid AS r FROM ${T} WHERE ${k} = :id LIMIT 1`, { id }); return r[0] && r[0].r; };
  let created = 0, existed = 0;
  const missing = [];
  for (const l of st.links) {
    const a = await ridOf('task', l.task_uid), b = await ridOf(l.target.type, l.target.id);
    if (!a || !b) { missing.push(`${l.task_uid} → ${l.target.id}`); continue; }
    const cur = await db.dstQuery(`SELECT count(*) AS n FROM DEPENDS_ON WHERE @out = ${a} AND @in = ${b} AND valid_to IS NULL`);
    if (cur[0] && cur[0].n > 0) { existed++; continue; }
    await db.dstCommand(`CREATE EDGE DEPENDS_ON FROM ${a} TO ${b} CONTENT :c`, { c: { kind: WAIT_KIND, reason: l.reason, valid_from: l.valid_from || at, mig_rule: RULE } });
    created++;
  }
  const got = (await db.dstQuery(`SELECT count(*) AS n FROM DEPENDS_ON WHERE mig_rule = '${RULE}'`))[0].n;
  const ok = got === created && !missing.length;
  log(`ожидание → связи: текстов ${st.counts.texts_with_waiting_for} · стало связями ${st.counts.became_links} (рёбер ${created}, уже были ${existed}) · осталось текстом ${st.counts.stayed_text} (адресат прошлого статуса ${st.counts.stale}, без записи планирования ${st.counts.not_planning_or_no_ref}) · ждёт решения ${st.counts.waiting}${missing.length ? ' · конца нет: ' + missing.join(', ') : ''}`);
  return { ok, ...st.counts, created, existed, missing };
}
