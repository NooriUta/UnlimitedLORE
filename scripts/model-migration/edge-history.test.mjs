// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-02 — историчные связи при переносе: список и поля берутся из модели,
// ребру ставится «действует с», у текущих «действует по» пусто, свойства объявлены в схеме приёмника.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORIC_EDGES, EDGE_HISTORY_FIELDS, isHistoric, edgeVersion, edgeHistoryDdl } from './edge-history.mjs';
import { transferEdges } from './transfer-edges.mjs';

const AT = '2026-11-19T10:00:00.000Z';

test('историчные связи и поля версии — из модели', () => {
  assert.deepEqual([...HISTORIC_EDGES].sort(), ['FILLS_ROLE', 'HAS_PROJECT_ROLE', 'IN_PHASE', 'ROLE_HELD_BY', 'TARGETS_MILESTONE']);
  assert.deepEqual(EDGE_HISTORY_FIELDS, ['valid_from', 'valid_to']);
  assert.ok(!isHistoric('PART_OF'));
});

test('valid_from: своё у ребра, потом момент создания, потом первая версия записи, потом момент переноса', () => {
  assert.deepEqual(edgeVersion({ valid_from: '2026-08-31T06:06:07.177807935Z', valid_to: '2026-09-15T13:58:46.674Z' }, AT),
    { valid_from: '2026-08-31T06:06:07.177Z', valid_to: '2026-09-15T13:58:46.674Z', source: 'edge.valid_from' }, 'закрытое ребро сохраняет valid_to');
  assert.equal(edgeVersion({ created_at: '2026-10-01 12:00:00' }, AT).source, 'edge.created_at');
  const v = edgeVersion({ out_versions: ['2026-10-05T00:00:00Z', '2026-09-01 08:00:00.000'] }, AT);
  assert.deepEqual(v, { valid_from: '2026-09-01T08:00:00.000Z', valid_to: null, source: 'out.first_version' });
  assert.equal(edgeVersion({ out_created: '2026-07-01' }, AT).valid_from, '2026-07-01T00:00:00.000Z');
  assert.deepEqual(edgeVersion({}, AT), { valid_from: AT, valid_to: null, source: 'transfer' });
});

test('схема приёмника: поля версии объявлены у историчной связи и только у неё', () => {
  assert.deepEqual(edgeHistoryDdl('IN_PHASE'), ['CREATE PROPERTY IN_PHASE.valid_from DATETIME', 'CREATE PROPERTY IN_PHASE.valid_to DATETIME']);
  assert.deepEqual(edgeHistoryDdl('PART_OF'), []);
});

test('перенос связей: IN_PHASE получает valid_from и объявленные свойства, PART_OF — нет', async () => {
  const cmds = [];
  const created = { IN_PHASE: [], PART_OF: [] };
  const own = { KnowTask: [['#1:0', '#10:0']], KnowPhase: [['#2:0', '#20:0']], KnowSprint: [['#3:0', '#30:0']] };
  const db = {
    env: { MIG_DST_DB: 'migration_dst_test', MIG_SRC_DB: 'src' },
    async src(q) {
      if (/schema:types/.test(q)) return [{ name: 'IN_PHASE', type: 'edge', records: 1 }, { name: 'PART_OF', type: 'edge', records: 1 }];
      if (/GROUP BY o, i/.test(q)) return /FROM IN_PHASE/.test(q) ? [{ o: 'KnowTask', i: 'KnowPhase', n: 1 }] : [{ o: 'KnowTask', i: 'KnowSprint', n: 1 }];
      if (/@rid > #-1:-1/.test(q) && /FROM IN_PHASE/.test(q)) {
        assert.match(q, /out_versions/, 'для историчной связи читаются моменты записи');
        return [{ r: '#50:0', o: '#1:0', i: '#2:0', out_versions: ['2026-09-01T08:00:00Z'] }];
      }
      if (/@rid > #-1:-1/.test(q) && /FROM PART_OF/.test(q)) { assert.doesNotMatch(q, /valid_from/); return [{ r: '#51:0', o: '#1:0', i: '#3:0' }]; }
      return [];
    },
    async dstQuery(q) {
      const m = q.match(/FROM (\w+) WHERE @rid > #-1:-1/);
      if (m && own[m[1]]) return own[m[1]].map(([s, r]) => ({ s, r }));
      if (/schema:types/.test(q)) return [];
      const e = q.match(/mig_src_rid AS s, @out.mig_src_rid AS o, @in.mig_src_rid AS i FROM (\w+)/);
      if (e && /#-1:-1/.test(q)) return created[e[1]].map((c, k) => ({ r: '#9' + k + ':0', s: c.mig_src_rid, o: c.o, i: c.i }));
      return [];
    },
    async dstCommand(q, p) {
      cmds.push(q);
      const m = q.match(/^CREATE EDGE (\w+) FROM (\S+) TO (\S+) CONTENT/);
      if (m) {
        const back = r => Object.values(own).flat().find(([, d]) => d === r)[0];
        created[m[1]].push({ ...p.c, o: back(m[2]), i: back(m[3]) });
      }
      return [];
    },
  };
  const { EDGES } = await import('./resources.mjs');
  assert.equal(EDGES.IN_PHASE.rule, 'keep', 'положительный контроль: IN_PHASE переносится этим шагом');
  const report = await transferEdges(db, { log: () => {}, at: AT });
  assert.ok(report.ok, JSON.stringify(report));
  assert.deepEqual(created.IN_PHASE.map(c => [c.valid_from, c.valid_to]), [['2026-09-01T08:00:00.000Z', undefined]]);
  assert.ok(!('valid_from' in created.PART_OF[0]), 'неисторичная связь без полей версии');
  assert.ok(cmds.includes('CREATE PROPERTY IN_PHASE.valid_from DATETIME') && cmds.includes('CREATE PROPERTY IN_PHASE.valid_to DATETIME'));
  assert.ok(!cmds.some(c => /PART_OF\.valid_from/.test(c)));
  assert.deepEqual(report.moved.IN_PHASE.valid_from_source, { 'out.first_version': 1 });
});
