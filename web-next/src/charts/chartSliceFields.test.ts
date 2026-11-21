// Владелица 21.11.2026 (паспорт проекта на препроде): «Ритм релизов — PR в релизе … Не загрузилось: BAD_PARAMS:
// unknown field(s) [released_at] — this slice returns: [changed_at, description_md, git_project, git_tag, is_current,
// pr_count, project_hosts, projects, release_date, release_id, release_uid, sprint_count, type, version, week]».
// Сторож: поля, которые график просит у среза, — только колонки, которые срез отдаёт (список — из ответа сервера).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const SLICE_COLUMNS: Record<string, string[]> = {
  releases: ['changed_at', 'description_md', 'git_project', 'git_tag', 'is_current', 'pr_count', 'project_hosts', 'projects', 'release_date', 'release_id', 'release_uid', 'sprint_count', 'type', 'version', 'week'],
};
const dir = `${process.cwd()}/src/charts`;
const asks = readdirSync(dir).filter(f => /\.tsx?$/.test(f) && !/\.test\./.test(f))
  .flatMap(f => [...readFileSync(`${dir}/${f}`, 'utf8').matchAll(/useSlice\(p, '([a-z_]+)', \{ fields: '([^']+)'/g)].map(m => ({ f, slice: m[1], fields: m[2].split(',') })));

describe('графики просят у среза только существующие колонки', () => {
  it('найдены запросы полей', () => { expect(asks.length).toBeGreaterThan(0); });
  it.each(asks.filter(a => SLICE_COLUMNS[a.slice]).map(a => [a.f, a.slice, a.fields] as const))('%s → %s', (_f, slice, fields) => {
    expect(fields.filter(x => !SLICE_COLUMNS[slice].includes(x))).toEqual([]);
  });
});
