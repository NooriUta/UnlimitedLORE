// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Трек спринта — своя запись и историчное ребро ON_TRACK.
// Владелица 20.11.2026: «треки б» — трек не поле спринта и не вид зависимости, а маленький справочник-вершина и связь
// «спринт → трек», как у вехи (TARGETS_MILESTONE); «трек как веха но меньше паспорт ему тоже сделай».
//   - треки старой доски (PlanTrack, 18 записей) переносятся вершинами KnowTrack: код (track_id), подпись, вид (area);
//   - track_id ОТКРЫТОЙ версии спринта → ребро ON_TRACK спринт → трек; valid_from — по правилу edge-history
//     (последнее обновление концов: версии и updated_at спринта; у трека своих моментов нет), иначе момент снимка;
//   - поле track_id в 1.18 снимается (карта: drop): каждое непустое значение версии — в остаток MigLeftover
//     с причиной «перенесено в ребро ON_TRACK»; трека нет в доске или два разных открытых значения — ребра нет,
//     причина в той же строке остатка (ничего не выдумывается и не теряется молча);
//   - сверка «было = стало»: треков столько же, сколько в доске; спринтов с треком — сколько рёбер, концы те;
//     строк остатка — сколько версий несли track_id.
// Шаг идёт после переноса записей (transfer.mjs): источник только читается, спринты приёмника ищутся по mig_src_rid.
// План детерминирован: не зависит от порядка строк.
import { edgeHistoryDdl, lastUpdate } from './edge-history.mjs';

export const TRACK_EDGE = 'ON_TRACK';
export const TRACK_VERTEX = 'KnowTrack';
/** Свои типы шага: пересоздаются повторным переносом (step-types.mjs). */
export const TRACK_TYPES = [TRACK_VERTEX, TRACK_EDGE];
export const TRACK_LEFT_WHY = 'перенесено в ребро ON_TRACK';
const RULE = 'sprint-track';
const LEFT_KIND = 'sprint_track';
const FIELDS = ['track_id', 'label', 'area'];

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const norm = v => (v === undefined || v === null ? '' : String(v).trim());
const list = v => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/**
 * План. tracks: [{rid, track_id, label, area}] (PlanTrack источника); sprints: [{rid, sprint_id, updated_at, versions}]
 * (versions — valid_from всех версий спринта); versions: [{r, owners, track_id, valid_to}] — версии источника с
 * непустым track_id; dstSprint: адрес спринта источника → адрес в приёмнике; at — момент снимка.
 */
export function planTracks({ tracks, sprints, versions, dstSprint, at }) {
  const T = [...tracks].sort((a, b) => byCode(norm(a.track_id), norm(b.track_id)))
    .map(t => ({ track_id: norm(t.track_id), label: t.label ?? null, area: t.area ?? null, mig_src_rid: t.rid }));
  const known = new Set(T.map(t => t.track_id));
  const sprintOf = new Map(sprints.map(s => [s.rid, s]));
  const V = [...versions].filter(x => norm(x.track_id)).sort((a, b) => byCode(String(a.r), String(b.r)));
  // открытые значения по спринту
  const open = new Map();
  for (const x of V) {
    if (x.valid_to !== null && x.valid_to !== undefined && x.valid_to !== '') continue;
    for (const o of list(x.owners)) {
      const s = open.get(o) || new Set();
      s.add(norm(x.track_id));
      open.set(o, s);
    }
  }
  const why = new Map(); // адрес версии → причина остатка
  const edges = [];
  let noVertex = 0, ambiguous = 0;
  const withOpen = new Set();
  for (const [o, vals] of [...open.entries()].sort((a, b) => byCode(String(a[0]), String(b[0])))) {
    const s = sprintOf.get(o);
    if (!s) continue;
    withOpen.add(o);
    if (vals.size > 1) {
      ambiguous++;
      for (const x of V) if (list(x.owners).includes(o) && !x.valid_to)
        why.set(x.r, `${TRACK_LEFT_WHY}: у спринта ${s.sprint_id} в открытых версиях разные треки (${[...vals].sort().join(', ')}) — неоднозначно, ребра нет`);
      continue;
    }
    const track = [...vals][0];
    if (!known.has(track)) {
      noVertex++;
      for (const x of V) if (list(x.owners).includes(o) && !x.valid_to)
        why.set(x.r, `${TRACK_LEFT_WHY}: трека «${track}» нет среди треков доски (PlanTrack) — ребра нет`);
      continue;
    }
    const from = dstSprint.get(o);
    if (!from) continue;
    const last = lastUpdate(s.versions, s.updated_at);
    edges.push({ sprint: s.sprint_id, track, from, valid_from: last || at, valid_from_source: last ? 'ends.last_update' : 'transfer' });
  }
  edges.sort((a, b) => byCode(a.sprint, b.sprint));
  // «трек только в закрытых версиях»: спринт без открытого значения, но с закрытым — ребра нет (переносится открытая)
  const closedOnly = new Set();
  for (const x of V) for (const o of list(x.owners)) if (!withOpen.has(o) && sprintOf.has(o)) closedOnly.add(o);
  const leftovers = V.map(x => ({ src_type: 'KnowSprintHist', src_rid: x.r, field: 'track_id', value: norm(x.track_id), kind: LEFT_KIND, why: why.get(x.r) || TRACK_LEFT_WHY }));
  const counts = {
    tracks: T.length, versions_with_track: V.length,
    open_with_track: V.filter(x => !x.valid_to).length,
    sprints_with_track: edges.length, edges: edges.length,
    no_track_vertex: noVertex, closed_only: closedOnly.size, ambiguous, leftovers: leftovers.length,
  };
  return { tracks: T, edges, leftovers, counts };
}

/** Данные: треки и версии — из источника (только чтение), спринты приёмника — по mig_src_rid. */
export async function readTrackInput(db) {
  const srcTypes = new Set((await db.src('SELECT name FROM schema:types')).map(x => x.name));
  const tracks = srcTypes.has('PlanTrack') ? await db.src('SELECT @rid AS rid, track_id, label, area FROM PlanTrack') : [];
  const versions = srcTypes.has('KnowSprintHist')
    ? (await db.src("SELECT @rid AS r, track_id, valid_to, in('HAS_STATE').@rid AS owners FROM KnowSprintHist WHERE track_id IS NOT NULL AND track_id <> ''"))
    : [];
  const owners = [...new Set(versions.flatMap(x => list(x.owners)))].sort();
  const sprints = owners.length
    ? (await db.src(`SELECT @rid AS rid, sprint_id, updated_at, out('HAS_STATE').valid_from AS versions FROM KnowSprint WHERE @rid IN [${owners.join(', ')}]`))
    : [];
  const dstSprint = new Map((await db.dstQuery('SELECT @rid AS r, mig_src_rid AS s FROM KnowSprint WHERE mig_src_rid IS NOT NULL')).map(x => [x.s, x.r]));
  return { tracks, versions, sprints, dstSprint };
}

/**
 * Записать вершины, рёбра и остаток. Типы шага пересоздаются — повтор не плодит дублей; строки остатка шага
 * снимаются и пишутся заново. Сверка: треков = план, спринтов с ребром = план (концы те), остатка = план.
 */
export async function applyTracks(db, plan, { log = console.log } = {}) {
  const types = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
  if (types.has(TRACK_EDGE)) await db.dstCommand(`DROP TYPE ${TRACK_EDGE} UNSAFE`);
  if (types.has(TRACK_VERTEX)) await db.dstCommand(`DROP TYPE ${TRACK_VERTEX} UNSAFE`);
  await db.dstCommand(`CREATE VERTEX TYPE ${TRACK_VERTEX}`);
  for (const f of [...FIELDS, 'mig_src_rid']) await db.dstCommand(`CREATE PROPERTY ${TRACK_VERTEX}.${f} STRING`);
  await db.dstCommand(`CREATE INDEX ON ${TRACK_VERTEX} (track_id) UNIQUE`);
  await db.dstCommand(`CREATE EDGE TYPE ${TRACK_EDGE}`);
  for (const ddl of edgeHistoryDdl(TRACK_EDGE)) await db.dstCommand(ddl);
  const ridOf = new Map();
  for (const t of plan.tracks) {
    const c = Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null && v !== undefined));
    const res = await db.dstCommand(`INSERT INTO ${TRACK_VERTEX} CONTENT :c`, { c });
    ridOf.set(t.track_id, res && res[0] ? res[0]['@rid'] : null);
  }
  const want = new Map();
  for (const e of plan.edges) {
    const to = ridOf.get(e.track);
    await db.dstCommand(`CREATE EDGE ${TRACK_EDGE} FROM ${e.from} TO ${to} CONTENT :c`, { c: {
      mig_rule: RULE, mig_sprint: e.sprint, mig_value: e.track, origin: 'migration:track_id',
      valid_from: e.valid_from, mig_valid_from_source: e.valid_from_source } });
    want.set(e.sprint, `${e.from}>${to}`);
  }
  await db.dstCommand(`DELETE FROM MigLeftover WHERE kind = '${LEFT_KIND}'`);
  for (const x of plan.leftovers) await db.dstCommand('INSERT INTO MigLeftover CONTENT :c', { c: x });

  const tracksGot = (await db.dstQuery(`SELECT count(*) AS n FROM ${TRACK_VERTEX}`))[0].n;
  const got = await db.dstQuery(`SELECT @out AS o, @in AS i, mig_sprint AS s, valid_from AS vf, valid_to AS vt FROM ${TRACK_EDGE} WHERE valid_to IS NULL`);
  let wrong = 0;
  for (const x of got) if (want.get(x.s) !== `${x.o}>${x.i}`) wrong++;
  const sprintsGot = new Set(got.map(x => x.s)).size;
  const leftGot = (await db.dstQuery(`SELECT count(*) AS n FROM MigLeftover WHERE kind = '${LEFT_KIND}'`))[0].n;
  const check = {
    tracks: { was: plan.tracks.length, now: tracksGot },
    sprints_with_track: { was: plan.edges.length, now: sprintsGot },
    edges_wrong_ends: wrong,
    leftovers: { was: plan.leftovers.length, now: leftGot },
  };
  const ok = tracksGot === plan.tracks.length && sprintsGot === plan.edges.length && got.length === plan.edges.length && !wrong && leftGot === plan.leftovers.length;
  const c = plan.counts;
  log(`трек спринта (${TRACK_EDGE}): треков ${c.tracks} → вершин ${tracksGot} · версий с track_id ${c.versions_with_track} (открытых ${c.open_with_track}) · спринтов с треком ${c.sprints_with_track} → рёбер ${got.length} · трека нет в доске ${c.no_track_vertex} · неоднозначно ${c.ambiguous} · трек только в закрытых версиях ${c.closed_only} · остаток ${leftGot} из ${c.leftovers}`);
  log('сверка «трек спринта»:', ok ? 'сошлась' : 'НЕ сошлась');
  return { ok, counts: c, check };
}
