// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Трек спринта — своя запись и историчное ребро ON_TRACK (владелица 20.11.2026: «треки б»).
//   - 18 треков старой доски (PlanTrack) переносятся вершинами KnowTrack: код, подпись, вид;
//   - track_id ОТКРЫТОЙ версии спринта становится ребром ON_TRACK спринт → трек; valid_from — по правилу edge-history
//     (последнее обновление концов), иначе момент снимка;
//   - track_id снимается: каждое непустое значение версии уходит в остаток с причиной «перенесено в ребро ON_TRACK»;
//   - сверка «было = стало»: спринтов с треком столько же, сколько рёбер; остатка — сколько версий с track_id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import model from '../../shared/model/lore-model.json' with { type: 'json' };
import mapSpt from './map/sprint-phase-task.json' with { type: 'json' };
import schemaSpt from './schema/sprint-phase-task.json' with { type: 'json' };
import { TRACK_EDGE, TRACK_VERTEX, TRACK_TYPES, TRACK_LEFT_WHY, planTracks, applyTracks } from './tracks.mjs';
import { EDGE_STEP_TYPES } from './step-types.mjs';

const tracks = [
  { rid: '#5:2', track_id: '2', label: 'Hound / Parser', area: 'engine' },
  { rid: '#5:0', track_id: '0', label: 'Arch / ADR', area: 'service' },
  { rid: '#5:11', track_id: '11', label: 'ANVIL + MIMIR', area: 'service' },
];
// версии источника: r — адрес версии, owners — спринты-владельцы (адреса источника), open — valid_to пусто
const v = (r, owners, track_id, open = true) => ({ r, owners, track_id, valid_to: open ? null : '2026-07-01T00:00:00Z' });
const sprints = [
  { rid: '#10:1', sprint_id: 'SPRINT_HOUND_S3', updated_at: '2026-06-20T10:00:00Z', versions: ['2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z'] },
  { rid: '#10:2', sprint_id: 'SPRINT_ANVIL_CORE', updated_at: null, versions: ['2026-05-01T00:00:00Z'] },
  { rid: '#10:3', sprint_id: 'SPRINT_GHOST', updated_at: null, versions: [] },
  { rid: '#10:4', sprint_id: 'SPRINT_OLD_ONLY', updated_at: null, versions: ['2026-04-01T00:00:00Z'] },
  { rid: '#10:5', sprint_id: 'SPRINT_LORE_X', updated_at: null, versions: ['2026-04-01T00:00:00Z'] },
];
const dstSprint = new Map([['#10:1', '#110:1'], ['#10:2', '#110:2'], ['#10:3', '#110:3'], ['#10:4', '#110:4'], ['#10:5', '#110:5']]);
const versions = [
  v('#20:1', ['#10:1'], '2', false), // закрытая — только в остаток
  v('#20:2', ['#10:1'], '2'),        // открытая → ребро
  v('#20:3', ['#10:2'], '11'),
  v('#20:4', ['#10:3'], '99'),       // трека нет в доске — ребра нет, остаток с причиной
  v('#20:5', ['#10:4'], '0', false), // трек только в закрытой версии — ребра нет (переносится открытая)
];

test('модель: тип «трек» (вершина KnowTrack, ключ track_id), связь спринта ON_TRACK, историчная, с подписью и обратной', () => {
  assert.equal(TRACK_EDGE, 'ON_TRACK');
  assert.equal(TRACK_VERTEX, 'KnowTrack');
  assert.deepEqual(model.graph.track, { vertex: 'KnowTrack', key: 'track_id' });
  const st = model.types.find(t => t.type === 'sprint');
  const f = st.fields.find(x => x.key === 'track');
  assert.equal(f.kind, 'ref');
  assert.equal(f.rel, TRACK_EDGE);
  assert.equal(f.refType, 'track');
  assert.ok(!f.multi, 'у спринта один трек');
  const out = st.relations.find(r => r.rel === TRACK_EDGE && r.dir === 'out');
  assert.equal(out.label, 'Трек');
  const tt = model.types.find(t => t.type === 'track');
  const back = tt.relations.find(r => r.rel === TRACK_EDGE && r.dir === 'in');
  assert.equal(back.targetType, 'sprint');
  assert.equal(back.label, 'Спринты на треке');
  assert.ok(model.edge_history.edges[TRACK_EDGE], 'история в самом ребре');
  assert.ok(model.read_only.includes('track'), 'трек только для чтения: создания из UI нет');
});

test('карта и схема: track_id версии спринта не переносится полем — снят с причиной; свои типы шага в общем списке', () => {
  const rule = mapSpt.types.KnowSprintHist.track_id;
  assert.equal(rule.rule, 'drop');
  assert.match(rule.why, /перенесено в ребро ON_TRACK/);
  assert.equal(schemaSpt.types.KnowSprintHist.fields.track_id, undefined, 'в схеме приёмника поля нет');
  for (const t of TRACK_TYPES) assert.ok(EDGE_STEP_TYPES.includes(t), t + ' — свой тип шага связей (--reset пересоздаёт)');
});

test('план: треки — вершинами; открытая версия → ребро; закрытые и прочие — в остаток; счёт по случаям', () => {
  const p = planTracks({ tracks, sprints, versions, dstSprint, at: '2026-11-18T00:00:00Z' });
  assert.deepEqual(p.tracks.map(t => t.track_id), ['0', '11', '2']);
  assert.deepEqual(p.tracks[2], { track_id: '2', label: 'Hound / Parser', area: 'engine', mig_src_rid: '#5:2' });
  assert.deepEqual(p.edges.map(e => [e.sprint, e.track]), [['SPRINT_ANVIL_CORE', '11'], ['SPRINT_HOUND_S3', '2']]);
  const hound = p.edges.find(e => e.sprint === 'SPRINT_HOUND_S3');
  assert.equal(hound.from, '#110:1');
  assert.equal(hound.valid_from, '2026-06-20T10:00:00.000Z', 'последнее обновление концов: updated_at спринта позже его версий');
  assert.equal(hound.valid_from_source, 'ends.last_update');
  assert.equal(p.edges.find(e => e.sprint === 'SPRINT_ANVIL_CORE').valid_from, '2026-05-01T00:00:00.000Z');
  // остаток: каждое непустое значение версии — с причиной
  assert.equal(p.leftovers.length, 5);
  for (const x of p.leftovers) {
    assert.equal(x.src_type, 'KnowSprintHist');
    assert.equal(x.field, 'track_id');
    assert.equal(x.kind, 'sprint_track');
    assert.match(x.why, /^перенесено в ребро ON_TRACK/);
  }
  assert.match(p.leftovers.find(x => x.src_rid === '#20:4').why, /трека «99» нет/);
  assert.deepEqual(p.counts, { tracks: 3, versions_with_track: 5, open_with_track: 3, sprints_with_track: 2, edges: 2, no_track_vertex: 1, closed_only: 1, ambiguous: 0, leftovers: 5 });
  assert.equal(TRACK_LEFT_WHY, 'перенесено в ребро ON_TRACK');
});

test('два открытых значения у одного спринта — неоднозначно: ребра нет, причина в остатке', () => {
  const p = planTracks({ tracks, sprints, versions: [v('#20:7', ['#10:5'], '2'), v('#20:8', ['#10:5'], '11')], dstSprint, at: '2026-11-18T00:00:00Z' });
  assert.equal(p.edges.length, 0);
  assert.equal(p.counts.ambiguous, 1);
  assert.ok(p.leftovers.every(x => /неоднозначно/.test(x.why)));
});

test('план детерминирован: порядок строк источника не меняет результат', () => {
  const a = planTracks({ tracks, sprints, versions, dstSprint, at: '2026-11-18T00:00:00Z' });
  const b = planTracks({ tracks: [...tracks].reverse(), sprints: [...sprints].reverse(), versions: [...versions].reverse(), dstSprint, at: '2026-11-18T00:00:00Z' });
  assert.deepEqual(a, b);
});

// Приёмник в памяти: KnowTrack, ON_TRACK, MigLeftover.
function fakeDb() {
  const vx = [], edges = [], left = [], ddl = [];
  let n = 0;
  return {
    vx, edges, left, ddl,
    env: { MIG_DST_DB: 'migration_dst_test' },
    async dstQuery(sql) {
      if (/schema:types/.test(sql)) return ['KnowTrack', 'ON_TRACK'].filter(t => ddl.includes(`CREATE ${t === 'KnowTrack' ? 'VERTEX' : 'EDGE'} TYPE ${t}`)).map(name => ({ name }));
      if (/count\(\*\) AS n FROM KnowTrack/.test(sql)) return [{ n: vx.length }];
      if (/FROM KnowTrack/.test(sql)) return vx.map(x => ({ r: x.r, t: x.c.track_id }));
      if (/FROM ON_TRACK/.test(sql)) return edges.map(e => ({ o: e.from, i: e.to, s: e.c.mig_sprint, vf: e.c.valid_from, vt: e.c.valid_to ?? null }));
      if (/FROM MigLeftover/.test(sql)) return [{ n: left.filter(x => x.kind === 'sprint_track').length }];
      throw new Error('запрос не ожидался: ' + sql);
    },
    async dstCommand(sql, p) {
      if (/^(DROP TYPE|CREATE (VERTEX TYPE|EDGE TYPE|PROPERTY|INDEX))/.test(sql)) {
        ddl.push(sql);
        if (/DROP TYPE KnowTrack/.test(sql)) vx.length = 0;
        if (/DROP TYPE ON_TRACK/.test(sql)) edges.length = 0;
        return [];
      }
      if (/INSERT INTO KnowTrack/.test(sql)) { const r = '#300:' + n++; vx.push({ r, c: p.c }); return [{ '@rid': r }]; }
      const m = /CREATE EDGE ON_TRACK FROM (\S+) TO (\S+)/.exec(sql);
      if (m) { edges.push({ from: m[1], to: m[2], c: p.c }); return [{}]; }
      if (/DELETE FROM MigLeftover/.test(sql)) { for (let i = left.length - 1; i >= 0; i--) if (left[i].kind === 'sprint_track') left.splice(i, 1); return []; }
      if (/INSERT INTO MigLeftover/.test(sql)) { left.push(p.c); return [{}]; }
      throw new Error('команда не ожидалась: ' + sql);
    },
  };
}

test('перенос: вершины, рёбра и остаток записаны; сверка «было = стало» сходится; повтор не плодит дублей', async () => {
  const db = fakeDb();
  const plan = planTracks({ tracks, sprints, versions, dstSprint, at: '2026-11-18T00:00:00Z' });
  const logs = [];
  let r = await applyTracks(db, plan, { log: (...s) => logs.push(s.join(' ')) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.check, { tracks: { was: 3, now: 3 }, sprints_with_track: { was: 2, now: 2 }, edges_wrong_ends: 0, leftovers: { was: 5, now: 5 } });
  assert.ok(db.ddl.some(s => s === 'CREATE VERTEX TYPE KnowTrack'));
  assert.ok(db.ddl.some(s => /CREATE INDEX ON KnowTrack \(track_id\) UNIQUE/.test(s)));
  assert.ok(db.ddl.some(s => /ON_TRACK\.valid_from DATETIME/.test(s)), 'поля версии ребра объявлены по модели');
  const e = db.edges.find(x => x.c.mig_sprint === 'SPRINT_HOUND_S3');
  assert.equal(e.from, '#110:1');
  assert.equal(e.to, db.vx.find(x => x.c.track_id === '2').r);
  assert.equal(e.c.origin, 'migration:track_id');
  assert.equal(e.c.mig_rule, 'sprint-track');
  assert.equal(e.c.valid_to, undefined, 'текущая связь открыта');
  assert.ok(logs.some(s => /трек спринта/.test(s) && /сошлась/.test(s)), logs.join(' | '));
  r = await applyTracks(db, plan, { log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(db.vx.length, 3, 'повтор не плодит вершины');
  assert.equal(db.edges.length, 2, 'и рёбра');
  assert.equal(db.left.length, 5, 'и остаток');
});

test('сверка ловит потерю: ребро не записалось — «не сошлась»', async () => {
  const db = fakeDb();
  const plan = planTracks({ tracks, sprints, versions, dstSprint, at: '2026-11-18T00:00:00Z' });
  const orig = db.dstCommand.bind(db);
  let skipped = false;
  db.dstCommand = async (sql, p) => (/CREATE EDGE ON_TRACK/.test(sql) && !skipped ? (skipped = true, [{}]) : orig(sql, p));
  const r = await applyTracks(db, plan, { log: () => {} });
  assert.equal(r.ok, false);
  assert.deepEqual(r.check.sprints_with_track, { was: 2, now: 1 });
});
