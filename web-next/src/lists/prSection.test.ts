// 1.18, владелица 21.11.2026: «и в меню под релизы вход в PR сделай». Раздел «PR» — пункт меню сразу под «Релизами»
// (та же группа «Работа»), список всех PR со скоупом проекта и паспорт PR (#1699) — по щелчку строки.
import { describe, expect, it } from 'vitest';
import { V2_SECTIONS, v2Config } from '../shell/v2Config';
import { readRoute, recordHref, sectionOfType } from '../nav/loreRoutes';
import { LIST_SCREENS } from './screens';
import { prRecord } from './records';
import { PASSPORT_OF } from '../pages/ListScreen';

const params = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));
const UID = 'NooriUta/UnlimitedLORE#1641';

describe('раздел «PR»', () => {
  it('пункт меню сразу под «Релизами» в той же группе', () => {
    expect(V2_SECTIONS as readonly string[]).toContain('pr');
    const work = v2Config('ru').menu.groups.find(g => g.items.some(i => i.id === 'release'))!;
    const ids = work.items.map(i => i.id);
    expect(ids[ids.indexOf('release') + 1]).toBe('pr');
  });

  it('у PR свой раздел: ссылка ведёт в «PR», ключ с «#» целиком; щелчок строки — паспорт PR', () => {
    expect(sectionOfType('pr')).toBe('pr');
    const p = params(recordHref('pr', UID)!);
    expect(p.get('sec')).toBe('pr');
    expect(readRoute(p).record).toEqual({ kind: 'pr', id: UID });
    expect((PASSPORT_OF as Record<string, string>).prs).toBe('pr');
  });

  it('список: срез prs, колонки, фильтры (проект, состояние, без заголовка, без релиза), порядок — по дате мержа', () => {
    const def = LIST_SCREENS.prs;
    expect(def.slice).toBe('prs');
    const cfg = def.config('ru');
    expect(cfg.list?.columns).toEqual(['title', 'project', 'repository', 'state', 'merged_at', 'branches', 'releases']);
    expect(cfg.list?.filters).toEqual(expect.arrayContaining(['fields.project', 'fields.state', 'fields.no_title', 'fields.no_release']));
  });

  it('строка: заголовок, нет — ключ; релизы — по ключу «проект#тег», подпись — тег; признаки «без заголовка», «без релиза»', () => {
    const r = prRecord({ pr_uid: UID, title: 'feat: паспорт PR', git_projects: ['NooriUta/UnlimitedLORE'], state: 'merged',
      merged_at: '2026-11-20T18:02:11Z', head_ref: 'feat/md05', base_ref: 'develop', release_uids: ['NooriUta/UnlimitedLORE#v1.18.0'],
      project_slugs: ['NooriUta/UnlimitedLORE'], project_titles: ['LORE'] });
    expect(r).toMatchObject({ id: UID, kind: 'pr', title: 'feat: паспорт PR' });
    expect(r.fields.project, 'проект — краткое название (#1708), ключ — в ссылке').toEqual([{ id: 'NooriUta/UnlimitedLORE', label: 'LORE' }]);
    expect(prRecord({ pr_uid: 'X/y#1', git_projects: ['X/y'] }).fields.project, 'без связи с проектом — ключ из поля').toEqual([{ id: 'X/y', label: 'X/y' }]);
    expect(r.fields).toMatchObject({ state: 'merged', merged_at: '2026-11-20T18:02:11Z',
      branches: 'feat/md05 → develop', no_title: '', no_release: '' });
    expect(r.fields.releases).toEqual([{ id: 'NooriUta/UnlimitedLORE#v1.18.0', label: 'v1.18.0' }]);
    const empty = prRecord({ pr_uid: 'AIDA/miniLORE#3' });
    expect(empty.title).toBe('AIDA/miniLORE#3');
    expect(empty.fields).toMatchObject({ no_title: '✓', no_release: '✓', releases: [] });
  });
});
