// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Новые связи модели сессий из данных LORE — D-2026-LORE-SESSION-MACHINE-PLACE-MODEL:
// машина пишется один раз строчными (LEGION — имя пользователя Windows, не машина); машины из сессий регистрируются (4а);
// ключ сессии — пара «машина + код» (2а); harness — код справочника. Здесь — только расчёт; запись — transfer-session.mjs.
// Места, «задача ↔ сессия» и «сессия → родитель» — данные miniLORE, не снимка LORE: вторым шагом.

/** Виды связей модели сессий — свои типы приёмника (transfer.ownTypes). */
export const SESSION_EDGES = ['NEW_ON_MACHINE', 'NEW_IN_PROJECT', 'NEW_RUNS_IN', 'NEW_CHANGED_IN'];

/** Код машины: строчными, без пробелов по краям; значение из списка «не машина» — null с причиной. */
export function canonMachine(raw, notMachines = []) {
  const id = String(raw ?? '').trim().toLowerCase();
  if (!id) return { id: null, why: 'машина не указана' };
  if (notMachines.includes(id)) return { id: null, why: `«${raw}» — имя пользователя Windows, а не машины; с машиной не склеивается` };
  return { id };
}

const pair = (machine, session) => `${machine}|${session}`;
const minStr = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const maxStr = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Вход — записи источника (адреса источника): sessions {rid, session_id, machine_id, project, started_at, last_activity_at},
 * machines {rid, machine_id}, projects {rid, slug, full_name, name}, harness {rid, code} (вершины справочника harness),
 * actors {rid, harness}, versions {rid, changed_by_session, changed_by_machine}, notMachines.
 * Выход: newMachines (регистрируются), edges {вид: [[от, к]]} — «к» машине новой или старой как 'machine:<код>',
 * unresolved {вид: [{rid, value, why}]} — что связью не стало и почему.
 */
export function planSessionModel({ sessions = [], machines = [], projects = [], harness = [], actors = [], versions = [], notMachines = [] }) {
  const edges = { NEW_ON_MACHINE: [], NEW_IN_PROJECT: [], NEW_RUNS_IN: [], NEW_CHANGED_IN: [] };
  const unresolved = { NEW_ON_MACHINE: [], NEW_IN_PROJECT: [], NEW_RUNS_IN: [], NEW_CHANGED_IN: [] };
  const known = new Set(machines.map(m => canonMachine(m.machine_id).id).filter(Boolean));
  const fresh = new Map(); // код → {first, last}
  const byPair = new Map();

  for (const s of sessions) {
    const m = canonMachine(s.machine_id, notMachines);
    if (!m.id) { unresolved.NEW_ON_MACHINE.push({ rid: s.rid, value: s.machine_id ?? null, why: m.why }); continue; }
    edges.NEW_ON_MACHINE.push([s.rid, 'machine:' + m.id]);
    if (s.session_id) byPair.set(pair(m.id, s.session_id), s.rid);
    if (!known.has(m.id)) {
      const f = fresh.get(m.id) || { first: null, last: null };
      f.first = minStr(f.first, s.started_at || s.last_activity_at || null);
      f.last = maxStr(f.last, s.last_activity_at || s.started_at || null);
      fresh.set(m.id, f);
    }
  }
  const newMachines = [...fresh.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([machine_id, f]) => ({ machine_id, first_seen_at: f.first, last_seen_at: f.last, registered_from: 'sessions' }));

  const projectBy = new Map();
  for (const p of projects) for (const k of [p.full_name, p.slug, p.name]) if (k) projectBy.set(String(k).toLowerCase(), p.rid);
  for (const s of sessions) {
    if (!s.project) continue;
    const p = projectBy.get(String(s.project).trim().toLowerCase());
    if (p) edges.NEW_IN_PROJECT.push([s.rid, p]);
    else unresolved.NEW_IN_PROJECT.push({ rid: s.rid, value: s.project, why: 'проекта с таким именем нет в реестре' });
  }

  const harnessBy = new Map(harness.map(h => [h.code, h.rid]));
  for (const a of actors) {
    if (!a.harness) continue;
    const h = harnessBy.get(a.harness);
    if (h) edges.NEW_RUNS_IN.push([a.rid, h]);
    else unresolved.NEW_RUNS_IN.push({ rid: a.rid, value: a.harness, why: 'кода нет в справочнике harness' });
  }

  for (const v of versions) {
    if (!v.changed_by_session) continue;
    const m = canonMachine(v.changed_by_machine, notMachines);
    const key = pair(m.id, v.changed_by_session);
    const s = m.id && byPair.get(key);
    if (s) edges.NEW_CHANGED_IN.push([v.rid, s]);
    else unresolved.NEW_CHANGED_IN.push({ rid: v.rid, value: key, why: m.id ? 'сессии с такой парой «машина + код» нет' : m.why });
  }
  return { newMachines, edges, unresolved };
}
