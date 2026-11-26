// Решение владелицы 19.11.2026 (D-2026-MIG-REPOSITORY-ORGANIZATION): «организацию пока с проектами, продуктами и
// людьми в админке связи и всё, и в админку её минимально». Управление — в админке (раздел «Организации»: список,
// создание, привязка проекта / продукта / человека в паспорте); в «Системе» пользовательского меню — только чтение.
import { describe, expect, it } from 'vitest';
import { ADMIN_SECTIONS, adminMenu } from './adminModule';
import { CREATE_TYPES, createFields, createRequest, missingRequired } from '../record/recordCreate';
import { relationOptionsHook } from '../record/relationOptions';
import { LIST_SCREENS } from '../lists/screens';
import { screenManaged } from '../pages/ListScreen';

describe('организации в админке', () => {
  it('раздел «Организации» в группе «Люди и агенты» рядом с проектами', () => {
    expect(ADMIN_SECTIONS as readonly string[]).toContain('adm-orgs');
    const people = adminMenu('ru').groups.find(g => g.id === 'adm-people');
    expect(people?.items.map(i => i.id)).toEqual(['adm-agents', 'adm-machines', 'adm-who', 'adm-projects', 'adm-orgs', 'adm-sessions']);
    expect(people?.items.find(i => i.id === 'adm-orgs')?.title).toBe('Организации');
    expect(adminMenu('en').groups.flatMap(g => g.items).find(i => i.id === 'adm-orgs')?.title).toBe('Organizations');
  });

  it('создание: код и название, путь /lore/organization', () => {
    expect(CREATE_TYPES as readonly string[]).toContain('organization');
    expect(createFields('organization', 'ru').map(f => f.key)).toEqual(['id', 'title']);
    expect(missingRequired('organization', { title: 'Seiðr Studio' })).toEqual(['id']);
    expect(createRequest('organization', { id: ' SEIDR_STUDIO ', title: 'Seiðr Studio' }))
      .toEqual({ url: '/lore/organization', body: { org_id: 'SEIDR_STUDIO', name: 'Seiðr Studio' } });
  });

  it('варианты привязки: проекты, продукты, люди — из их срезов', async () => {
    const asked: string[] = [];
    const rows: Record<string, Record<string, unknown>[]> = {
      git_projects: [{ slug: 'AIDA/UnlimitedLORE', name: 'LORE' }],
      products: [{ code: 'midgard', label_ru: 'Мидгард' }],
      users: [{ kc_sub: 'u-1', display_name: 'Анна' }],
    };
    const hook = relationOptionsHook([
      { rel: 'ORG_HAS_PROJECT', dir: 'out', target_type: 'project', label: 'Проекты' },
      { rel: 'ORG_HAS_PRODUCT', dir: 'out', target_type: 'product', label: 'Продукты' },
      { rel: 'ORG_MEMBER', dir: 'out', target_type: 'user', label: 'Люди' },
    ], async name => { asked.push(name); return { rows: rows[name] }; });
    expect(await hook({ type: 'organization', id: 'O', rel: 'ORG_HAS_PRODUCT', dir: 'out', query: '' }))
      .toEqual([{ id: 'midgard', title: 'Мидгард', type: 'product' }]);
    expect(await hook({ type: 'organization', id: 'O', rel: 'ORG_MEMBER', dir: 'out', query: 'ан' }))
      .toEqual([{ id: 'u-1', title: 'Анна', type: 'user' }]);
    expect(asked).toEqual(['products', 'users']);
  });

  it('в пользовательском меню — только чтение, управление — в админке', () => {
    const def = LIST_SCREENS.organizations;
    expect(def.manageOnlyInAdmin).toBe(true);
    expect(screenManaged(def, false)).toBe(false);
    expect(screenManaged(def, true)).toBe(true);
    expect(screenManaged(LIST_SCREENS.adrs, false), 'прочие разделы — как были').toBe(true);
  });
});
