import { describe, expect, it } from 'vitest';
import { releaseProjectOf, resolveReleaseRef, uidOfRelease } from './releaseProject';

// SPRINT_LORE_PROJECT_SCOPE/AL-96. Решение владельца 04.11.2026 (№14): проект у
// релиза — РЕБРО BELONGS_TO_PROJECT. Табы доски релизов жили на плоском поле
// git_project, а read-скоуп — на ребре: две правды об одном, и релиз мог
// стоять во вкладке одного проекта, будучи виден через скоуп другого.
describe('проект релиза берётся из ребра', () => {
  it('ребро есть — берём ребро, даже если поле говорит другое', () => {
    expect(releaseProjectOf({ projects: ['NooriUta/UnlimitedLORE'], git_project: 'NooriUta/AIDA' })).toBe('NooriUta/UnlimitedLORE');
  });

  it('ребра нет (старый релиз) — запасным вариантом поле', () => {
    expect(releaseProjectOf({ projects: [], git_project: 'NooriUta/AIDA' })).toBe('NooriUta/AIDA');
    expect(releaseProjectOf({ projects: [null], git_project: 'NooriUta/AIDA' })).toBe('NooriUta/AIDA');
  });

  it('нет ни того, ни другого — null, а не пустая строка', () => {
    expect(releaseProjectOf({ projects: null, git_project: null })).toBeNull();
  });
});

// AH-09: ?rel= из ленты новостей приходит как release_id (+ проект), а строка
// борда адресуется release_uid ?? release_id — резолвер сводит одно к другому.
describe('resolveReleaseRef', () => {
  const rows = [
    { release_id: 'v1.3.0', release_uid: 'NooriUta/AIDA#v1.3.0', git_project: 'NooriUta/AIDA' },
    { release_id: 'v1.3.0', release_uid: 'AIDA/seidr-site#v1.3.0', git_project: 'AIDA/seidr-site' },
    { release_id: 'v0.1.0', release_uid: null, git_project: null },
  ];
  it('точное совпадение uid', () => {
    expect(resolveReleaseRef(rows, 'AIDA/seidr-site#v1.3.0')?.git_project).toBe('AIDA/seidr-site');
  });
  it('проект#id без release_uid совпадает по паре проект+id', () => {
    const r2 = [{ release_id: 'v2.0.0', release_uid: null, git_project: 'AIDA/UnlimitedLORE' }];
    expect(resolveReleaseRef(r2, 'AIDA/UnlimitedLORE#v2.0.0')?.release_id).toBe('v2.0.0');
  });
  it('голый release_id: строка без uid', () => {
    expect(resolveReleaseRef(rows, 'v0.1.0')?.release_id).toBe('v0.1.0');
  });
  it('нет совпадения → null', () => {
    expect(resolveReleaseRef(rows, 'v9.9.9')).toBeNull();
  });
  it('uidOfRelease = release_uid ?? release_id', () => {
    expect(uidOfRelease(rows[0])).toBe('NooriUta/AIDA#v1.3.0');
    expect(uidOfRelease(rows[2])).toBe('v0.1.0');
  });
});
