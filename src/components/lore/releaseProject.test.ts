import { describe, expect, it } from 'vitest';
import { releaseProjectOf } from './releaseProject';

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
