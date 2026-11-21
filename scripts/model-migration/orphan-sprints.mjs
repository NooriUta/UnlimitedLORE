// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Задачи без спринта (нет ребра PART_OF) — шаг мастера переноса.
// Владелица 19.11.2026: «без спринта реконструировать ребро в визарде предложить владельцу привязать».
// Установщик только предлагает, с основанием; решает человек в мастере, ответ — раздел orphan_sprints файла
// решений: { map: { task_uid: sprint_id | null | { duplicate_of: task_uid } }, by, at }. Перенос ставит ребро
// PART_OF задача → спринт только по ответу; без ответа задача остаётся без спринта, в отчёте — «ждёт решения».
//
// Правило предложения, первое сработавшее:
//   1) exact     — приставка task_uid (до «/») сама есть в реестре спринтов или с SPRINT_ впереди;
//   2) duplicate — в другом спринте есть задача с тем же кодом (task_id): «возможен дубль» — вторая задача
//                  с тем же кодом не заводится; ответ «дубль» уводит задачу и её версии в остаток переноса;
//   3) similar   — похожий спринт: больше всего общих слов кода (слова длиннее двух букв, без SPRINT/BACKLOG),
//                  совпало не меньше половины слов приставки; «похоже, подтвердите»;
//   4) where     — ничего не нашлось: «куда?».
// В модели 1.18 у задачи и её версии нет поля sprint_id: спринт задачи — только ребро PART_OF.

const NOISE = new Set(['SPRINT', 'BACKLOG']);
const words = s => String(s || '').toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length > 2 && !NOISE.has(w));
const prefixOf = uid => { const i = String(uid || '').indexOf('/'); return i > 0 ? uid.slice(0, i) : String(uid || ''); };

/**
 * Предложения по задачам без спринта. tasks — [{ task_uid, task_id, title?, status_raw? }]; sprints — список
 * sprint_id реестра; uidsByCode — Map task_id → [task_uid задач со спринтом]. Порядок — по task_uid; одинаковые
 * данные — одинаковый ответ.
 */
export function proposeOrphanSprints({ tasks, sprints, uidsByCode }) {
  const reg = new Set(sprints);
  const sorted = [...sprints].sort();
  return [...tasks].sort((a, b) => String(a.task_uid).localeCompare(String(b.task_uid))).map(t => {
    const base = { task_uid: t.task_uid, task_id: t.task_id || null, title: t.title || null, status_raw: t.status_raw || null };
    const p = prefixOf(t.task_uid);
    const exact = [p, 'SPRINT_' + p].find(s => t.task_uid.includes('/') && reg.has(s));
    if (exact) return { ...base, kind: 'exact', sprint: exact, candidates: [exact], why: `приставка ${p} — спринт ${exact} из реестра` };
    const w = words(p);
    let best = 0, cands = [];
    for (const s of sorted) {
      const sw = new Set(words(s));
      const hit = w.filter(x => sw.has(x)).length;
      if (!hit || hit * 2 < w.length) continue;
      if (hit > best) { best = hit; cands = [s]; } else if (hit === best) cands.push(s);
    }
    cands.sort((a, b) => words(a).length - words(b).length || a.localeCompare(b));
    const same = ((uidsByCode && uidsByCode.get(t.task_id)) || []).filter(u => u !== t.task_uid).sort();
    if (same.length) {
      const of = same[0], sprint = prefixOf(of);
      // похожий спринт показывается рядом: человек сравнивает «дубль» и «похоже» сам
      const alt = cands.filter(s => !same.map(prefixOf).includes(s));
      return { ...base, kind: 'duplicate', sprint: reg.has(sprint) ? sprint : null, duplicate_of: of, candidates: [...same.map(prefixOf).filter(s => reg.has(s)), ...alt],
        why: `возможен дубль: задача с тем же кодом ${t.task_id} есть в спринте — ${same.join(', ')}` + (alt.length ? `; похожий спринт по коду — ${alt.join(', ')}` : '') };
    }
    if (cands.length) {
      return { ...base, kind: 'similar', sprint: cands[0], candidates: cands, why: `похоже, подтвердите: общие слова кода ${best} из ${w.length} — ${cands.join(', ')}` };
    }
    return { ...base, kind: 'where', sprint: null, candidates: [], why: 'ни спринта с этой приставкой, ни задачи с тем же кодом, ни похожего спринта — «куда?»' };
  });
}

/** Ответы человека из файла решений; нет раздела — пусто. Значение: sprint_id, null (оставить без спринта) или { duplicate_of }. */
export function orphanSprintAnswers(doc) {
  const m = doc && doc.orphan_sprints && typeof doc.orphan_sprints === 'object' ? doc.orphan_sprints.map || {} : {};
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v === null || (typeof v === 'string' && v) || (v && typeof v === 'object' && typeof v.duplicate_of === 'string' && v.duplicate_of)));
}

/** Записать ответы: прежние сохраняются, кто и когда — рядом. Без «кто принял» — отказ. */
export function withOrphanSprints(doc, map, by, at = new Date().toISOString()) {
  if (!by) throw new Error('не записано: не сказано, кто принял');
  const next = { ...orphanSprintAnswers(doc) };
  for (const [k, v] of Object.entries(map || {})) {
    if (v === null) next[k] = null;
    else if (typeof v === 'string' && v.trim()) next[k] = v.trim();
    else if (v && typeof v === 'object' && typeof v.duplicate_of === 'string' && v.duplicate_of.trim()) next[k] = { duplicate_of: v.duplicate_of.trim() };
    else throw new Error(`спринт задачи ${k} — не код`);
  }
  return { ...doc, orphan_sprints: { map: next, by, at } };
}

/** Итог по ответам: ставить ребро, дубль (в остаток), оставить без спринта, ждёт решения. */
export function orphanSprintState(proposals, answers) {
  const link = [], duplicate = [], keep = [], waiting = [];
  for (const p of proposals) {
    const a = answers[p.task_uid];
    if (a === undefined) waiting.push(p.task_uid);
    else if (a === null) keep.push(p.task_uid);
    else if (typeof a === 'object') duplicate.push({ task_uid: p.task_uid, of: a.duplicate_of });
    else link.push({ task_uid: p.task_uid, sprint: a });
  }
  return { link, duplicate, keep, waiting };
}

/** Чтение для предложений: задачи без спринта, реестр спринтов, коды задач со спринтом. q — запрос к базе. */
export async function readOrphanSprintInput(q) {
  const tasks = await q("SELECT task_uid, task_id, title, status_raw FROM KnowTask WHERE out('PART_OF').size() = 0");
  const sprints = (await q('SELECT sprint_id FROM KnowSprint')).map(x => x.sprint_id).filter(Boolean);
  const uidsByCode = new Map();
  for (const x of await q("SELECT task_uid, task_id FROM KnowTask WHERE out('PART_OF').size() > 0")) if (x.task_id) (uidsByCode.get(x.task_id) || uidsByCode.set(x.task_id, []).get(x.task_id)).push(x.task_uid);
  return { tasks, sprints, uidsByCode };
}

/**
 * Шаг связей: ребро PART_OF задача → спринт по ответам человека; сверка — у каждой задачи ответа «спринт» ровно
 * одно такое ребро к названному спринту. Без ответа — «ждёт решения» в отчёте (не молча); дубли сюда не доходят.
 */
export async function applyOrphanSprints(db, doc, { log = console.log } = {}) {
  const answers = orphanSprintAnswers(doc);
  const loose = await db.dstQuery("SELECT @rid AS rid, task_uid FROM KnowTask WHERE out('PART_OF').size() = 0");
  const sprintRid = new Map((await db.dstQuery('SELECT @rid AS r, sprint_id FROM KnowSprint')).map(x => [x.sprint_id, x.r]));
  const st = orphanSprintState(loose.map(x => ({ task_uid: x.task_uid })), answers);
  const ridOf = new Map(loose.map(x => [x.task_uid, x.rid]));
  const unknown = st.link.filter(l => !sprintRid.has(l.sprint));
  for (const l of st.link) if (sprintRid.has(l.sprint)) await db.dstCommand(`CREATE EDGE PART_OF FROM ${ridOf.get(l.task_uid)} TO ${sprintRid.get(l.sprint)} CONTENT :c`, { c: { mig_rule: 'orphan-sprint' } });
  const got = await db.dstQuery("SELECT @out.task_uid AS t, @in.sprint_id AS s FROM PART_OF WHERE mig_rule = 'orphan-sprint'");
  const want = new Map(st.link.map(l => [l.task_uid, l.sprint]));
  const wrong = got.filter(x => want.get(x.t) !== x.s).length;
  const ok = got.length === st.link.length - unknown.length && !wrong && !unknown.length;
  const state = st.waiting.length ? 'ждёт решения' : 'решено';
  log(`задачи без спринта: ${loose.length} · привязано ${got.length} · оставлены без спринта ${st.keep.length} · ${state}${st.waiting.length ? ' — ' + st.waiting.join(', ') : ''}${unknown.length ? ' · спринта нет: ' + unknown.map(u => u.sprint).join(', ') : ''}`);
  return { ok, state, without_sprint: loose.length, linked: got.length, expected: st.link.length, wrong, keep: st.keep, waiting: st.waiting, unknown_sprint: unknown, links: st.link.map(l => `${l.task_uid} → ${l.sprint}`) };
}
