// D-2026-MIG-REPOSITORY-ORGANIZATION — разделы и паспорта «Репозитории» и «Организации» (прототип
// docs/prototypes/mig-repos-orgs.html, владелица 19.11.2026: «ок делаем пока так»). До них репозиторий был
// полем проекта, а организации не было вовсе: recordHref('repository') давал null.
import { describe, expect, it } from 'vitest';
import { readRoute, recordHref, sectionOfType } from '../nav/loreRoutes';
import { V2_SECTIONS, v2Config } from '../shell/v2Config';
import { LIST_SCREENS } from '../lists/screens';
import { organizationRecord, repositoryRecord } from '../lists/records';
import { PASSPORT_OF } from '../pages/ListScreen';
import { PASSPORT_TYPES } from './passportAdapters';

const params = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));
const URL = 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE';

describe('репозиторий и организация — разделы и паспорта', () => {
  it('оба типа — разделы оболочки: репозиторий — «Устройство», организация — «Организация», адрес записи и паспорт фасада', () => {
    for (const t of ['repository', 'organization']) {
      expect(V2_SECTIONS as readonly string[]).toContain(t);
      expect(sectionOfType(t)).toBe(t);
      expect(PASSPORT_TYPES as readonly string[]).toContain(t);
    }
    const grp = (id: string) => v2Config('ru').menu.groups.find(g => g.id === id)?.items.map(i => i.id) ?? [];
    expect(grp('system')).toContain('repository');
    expect(grp('org')).toContain('organization');
    const h = recordHref('repository', URL);
    expect(h, 'ключ — адрес со «://» — доходит до паспорта целиком').not.toBeNull();
    expect(readRoute(params(h!)).record).toEqual({ kind: 'repository', id: URL });
    expect(PASSPORT_TYPES[PASSPORT_TYPES.length - 1]).toBe('project');
  });

  it('щелчок по строке раздела открывает паспорт', () => {
    expect((PASSPORT_OF as Record<string, string>).repositories).toBe('repository');
    expect((PASSPORT_OF as Record<string, string>).organizations).toBe('organization');
  });

  it('основной репозиторий проекта: роль «основной», проект, зеркала', () => {
    const r = repositoryRecord({
      url: URL, full_path: 'git.seidrstudio.pro/AIDA/UnlimitedLORE', host: 'git.seidrstudio.pro', owner: 'AIDA', name: 'UnlimitedLORE',
      projects: ['AIDA/UnlimitedLORE'], project_roles: ['primary'], components: [], mirrors: ['https://github.com/NooriUta/UnlimitedLORE'],
      mirror_of: [], component_projects: [], mirror_projects: [],
    }, { lang: 'ru' });
    expect(r).toMatchObject({
      id: URL, kind: 'repository', title: 'git.seidrstudio.pro/AIDA/UnlimitedLORE', status: '',
      fields: { role: 'основной', project: ['AIDA/UnlimitedLORE'], host: 'git.seidrstudio.pro', hostOwner: 'AIDA', mirrors: ['github.com/NooriUta/UnlimitedLORE'] },
    });
  });

  it('репозиторий компонента — в группе проекта своего компонента; зеркало — в группе проекта оригинала', () => {
    const c = repositoryRecord({ url: 'https://git.seidrstudio.pro/AIDA/GLADSHEIM', full_path: 'git.seidrstudio.pro/AIDA/GLADSHEIM',
      projects: [], components: ['GLADSHEIM'], component_projects: ['AIDA/MIDGARD'] }, { lang: 'ru' });
    expect(c.fields).toMatchObject({ role: 'компонент', component: ['GLADSHEIM'], project: ['AIDA/MIDGARD'] });
    const m = repositoryRecord({ url: 'https://github.com/NooriUta/UnlimitedLORE', full_path: 'github.com/NooriUta/UnlimitedLORE',
      mirror_of: [URL], mirror_projects: ['AIDA/UnlimitedLORE'] }, { lang: 'en' });
    expect(m.fields).toMatchObject({ role: 'mirror', mirrorOf: ['git.seidrstudio.pro/AIDA/UnlimitedLORE'], project: ['AIDA/UnlimitedLORE'] });
    const none = repositoryRecord({ url: 'https://h/a/b', full_path: 'h/a/b' }, { lang: 'ru' });
    expect(none.fields.role).toBe('не привязан');
    expect(none.fields.project, 'проект не выдуман').toEqual([]);
  });

  it('раздел «Репозитории»: колонки прототипа, группировка по проекту по умолчанию', () => {
    const def = LIST_SCREENS.repositories;
    expect(def.slice).toBe('repositories');
    const cfg = def.config('ru');
    expect(cfg.list?.columns).toEqual(['title', 'role', 'project', 'component', 'mirrors']);
    expect(cfg.list?.groupings?.[0]).toBe('fields.project');
    expect(cfg.list?.filters).toEqual(expect.arrayContaining(['fields.host', 'fields.hostOwner', 'fields.role', 'fields.project']));
    expect(def.defaultGroup).toBe('fields.project');
  });

  it('раздел «Организации»: честное пустое состояние — не «пусто по ошибке»', () => {
    const def = LIST_SCREENS.organizations;
    expect(def.slice).toBe('organizations');
    const ru = def.config('ru').list?.empty;
    expect(ru?.title).toBe('Организаций пока нет');
    expect(ru?.hint).toContain('решает владелица');
    expect(def.config('en').list?.empty?.title).toBe('No organizations yet');
    expect(organizationRecord({ org_id: 'SEIDR_STUDIO', name: 'Seiðr Studio' })).toMatchObject({ id: 'SEIDR_STUDIO', kind: 'organization', title: 'Seiðr Studio' });
    expect(organizationRecord({ org_id: 'X' }).title).toBe('X');
  });
});
