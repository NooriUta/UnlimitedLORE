// SPRINT_LORE_KNOW_REGISTRY/KREG-10, п.4 (решение владельца 25.11.2026: «4а»).
//
// scripts/model-inconsistencies.mjs (KREG-08) на дампе схемы прода 24.11 дал 17 «пишется без схемы» и 60
// «неописанных» свойств. Разбор показал: большая часть — ошибки самой диагностики, а не модели:
//   • поле, которое живёт в версии записи (KnowSprintHist.status, KnowTaskHist.note_md…), искалось только на вершине;
//   • поле-связь (rel, edge_fields: роли задачи — ROLE_HELD_BY) считалось свойством;
//   • запись шла по имени параметра API, а свойство нашлось по ключу или псевдониму (sprint.title → name/title);
//   • служебные колонки (service_fields модели, *_uid, системные) шли в «неописанные».
// Настоящий случай был — ADR: поле «Дата» писалось в date_created, которого в схеме 1.18 нет. KREG-10 (25.11, «колонка
// пустая — удалить»): поле пишется в created_at — «пишется без схемы» больше нет; положительный контроль — та же схема
// без created_at у KnowADR.
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'lore-mi-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const v = (name: string, props: string[]) => ({ name, type: 'VERTEX', properties: props.map((p) => ({ name: p })) });
const schema = [
  v('KnowSprint', ['sprint_id', 'title', 'goal', 'created_at', 'updated_at', 'mig_src_rid', 'version', 'zz_new_prop']),
  v('KnowSprintHist', ['status', 'priority', 'planned_start_date', 'planned_end_date', 'context_md', 'outcome_md', 'state_uid', 'valid_from']),
  v('KnowTask', ['task_id', 'title', 'bookkeeping', 'src', 'mig_src_rid', 'updated_at']),
  v('KnowTaskHist', ['status', 'effort_days', 'note_md']),
  v('KnowADR', ['adr_id', 'name', 'status', 'created_at']),
  v('KnowADRHist', ['status']),
];

function run(sch: unknown[] = schema, tag = 'a') {
  const schemaPath = join(dir, `schema-${tag}.json`);
  const out = join(dir, `out-${tag}.json`);
  writeFileSync(schemaPath, JSON.stringify(sch));
  const r = spawnSync(process.execPath, [join(repo, 'scripts', 'model-inconsistencies.mjs'), '--schema', schemaPath, '--out', out], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(readFileSync(out, 'utf8'));
}

describe('диагностика модели: ложные срабатывания убраны, настоящие остаются (KREG-10 п.4)', () => {
  const rep = run();
  const written = (rep.writtenWithoutSchema as { type: string; field: string }[]).map((x) => `${x.type}.${x.field}`);
  const uncl = (rep.unclassified as { type: string; property: string }[]).map((x) => `${x.type}.${x.property}`);

  it('поле «Дата» ADR пишется в created_at — в схеме оно есть (KREG-10)', () => {
    expect(written).not.toContain('adr.date');
  });

  it('положительный контроль: без created_at у KnowADR поле «Дата» — «пишется без схемы»', () => {
    const noCreated = schema.map((t) => (t.name === 'KnowADR' ? v('KnowADR', ['adr_id', 'name', 'status']) : t));
    const r = run(noCreated, 'b');
    expect((r.writtenWithoutSchema as { type: string; field: string }[]).map((x) => `${x.type}.${x.field}`)).toContain('adr.date');
  });

  it('поле из версии записи (*Hist) — не «без схемы»', () => {
    for (const f of ['sprint.status', 'sprint.priority', 'sprint.planned_start', 'sprint.context_md', 'task.status', 'task.note_md', 'task.effort'])
      expect(written, f).not.toContain(f);
  });

  it('поле-связь (rel, edge_fields) — не свойство', () => {
    for (const f of ['task.author', 'task.executor', 'task.reviewer', 'task.realizes_uc'])
      expect(written, f).not.toContain(f);
  });

  it('свойство нашлось по ключу или псевдониму — запись по имени параметра API не в счёт', () => {
    expect(written).not.toContain('sprint.title');
  });

  it('служебные колонки (service_fields, *_uid, системные) — не «неописанные»', () => {
    for (const p of ['sprint.created_at', 'sprint.updated_at', 'sprint.mig_src_rid', 'sprint.version', 'task.bookkeeping', 'task.src', 'task.updated_at'])
      expect(uncl, p).not.toContain(p);
  });

  it('положительный контроль: свойство, которого нет ни в модели, ни в служебных, — неописанное', () => {
    expect(uncl).toContain('sprint.zz_new_prop');
  });
});
