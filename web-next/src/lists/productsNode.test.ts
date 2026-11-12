// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-PRODUCTS-NODE + S4-PRODUCT-HILITE — нода «Продукт» в v2.
//
// Владелица 11.11: «нода "Продукты" не отражена… разделы Use cases, Features,
// Products шли отдельным разделом… элементарные вещи, как боли, выгоды и
// пользовательские роли, можно было бы сделать». И к подсветке: «Продукты» и
// «Фичи» — не в «Устройстве».
//
// Держит: группа меню «Продукт» по смыслу (как глава «Зачем» v1), в ней
// продукты, фичи и сценарии, роли, боли, выгоды, работы; «Устройство» их больше
// не несёт (перенос, а не удаление: «Фичи» на месте, только в другой группе);
// у продукта есть паспорт; у болей, выгод, работ и ролей паспорта v2 нет —
// это сказано словами (NoPassport), а не замолчано.
import { describe, expect, it } from 'vitest';
import ru from '../i18n/ru.json';
import en from '../i18n/en.json';
import { v2Config, V2_SECTIONS } from '../shell/v2Config';
import { LIST_SCREENS } from './screens';
import { actorRecord, componentRecord, gainRecord, jobRecord, painRecord, productRecord } from './records';
import { PASSPORT_OF } from '../pages/ListScreen';
import { PASSPORT_TYPES } from '../record/passportAdapters';
import { TYPE_SECTION, recordHref } from '../nav/loreRoutes';
import { passportHref } from '../record/passportHref';

const PRODUCT_ITEMS = ['product', 'feature', 'actor', 'pain', 'gain', 'job'];

describe('меню: группа «Продукт»', () => {
  const groups = v2Config('ru').menu.groups;
  const groupOf = (id: string) => groups.find(g => g.items.some(i => i.id === id))?.id;

  it('продукты, фичи, роли, боли, выгоды, работы — одна группа по смыслу', () => {
    const g = groups.find(x => x.id === 'product');
    expect(g, 'группы «Продукт» нет').toBeTruthy();
    expect(g!.items.map(i => i.id)).toEqual(PRODUCT_ITEMS);
    for (const id of PRODUCT_ITEMS) expect(V2_SECTIONS as readonly string[], id).toContain(id);
  });

  it('«Продукты» и «Фичи» — не в «Устройстве»; «Фичи» перенесены, а не удалены', () => {
    const system = groups.find(x => x.id === 'system')!;
    const ids = system.items.map(i => i.id);
    expect(ids).not.toContain('feature');
    expect(ids).not.toContain('product');
    expect(ids).toEqual(['project', 'component', 'tech']);
    expect(groupOf('feature')).toBe('product');
  });

  it('подписи группы и разделов — в обеих локалях', () => {
    const r = ru as Record<string, string>;
    const e = en as Record<string, string>;
    for (const k of ['shell.grp.product', ...PRODUCT_ITEMS.map(i => `shell.sec.${i}`),
      'lists.products.title', 'lists.pains.title', 'lists.gains.title', 'lists.jobs.title', 'lists.actors.title',
      'pp.kind.product']) {
      expect(r[k], `ru ${k}`).toBeTruthy();
      expect(e[k], `en ${k}`).toBeTruthy();
    }
  });
});

describe('разделы «Продукт»: срезы, паспорта', () => {
  it('каждый раздел читает свой срез из каталога LoreSlices', () => {
    expect(LIST_SCREENS.products.slice).toBe('products');
    expect(LIST_SCREENS.pains.slice).toBe('pains');
    expect(LIST_SCREENS.gains.slice).toBe('gains');
    expect(LIST_SCREENS.jobs.slice).toBe('jobs');
    expect(LIST_SCREENS.actors.slice).toBe('actors');
  });

  it('у продукта — паспорт v2; у болей, выгод, работ и ролей его нет (честный отказ словами)', () => {
    expect(PASSPORT_OF.products).toBe('product');
    expect((PASSPORT_TYPES as readonly string[])).toContain('product');
    for (const s of ['pains', 'gains', 'jobs', 'actors'] as const) expect(PASSPORT_OF[s], s).toBeUndefined();
  });

  it('тип product открывается в своём разделе; чип продукта у компонента ведёт в паспорт продукта', () => {
    expect(TYPE_SECTION.product).toBe('product');
    const href = recordHref('product', 'LORE');
    expect(href).toContain('sec=product');
    expect(href).toContain('open=LORE');
    const h = passportHref([], { products: [{ id: 'LORE', label: 'Лор' }] }, id => `#${id}`);
    expect(h('LORE')).toBe(href);
  });
});

describe('мапперы строк продуктового слоя', () => {
  it('продукт: код, подпись, родитель, компоненты, проекты', () => {
    const r = productRecord({
      code: 'LORE', label_ru: 'Лор', label_en: 'Lore', color: '#E0A13D', parent_code: ['AIDA'],
      sub_products: ['LORE-M'], components: ['HND', 'SEIDRKIT'], git_projects: ['AIDA/UnlimitedLORE'], is_active: true,
    });
    expect(r).toMatchObject({ id: 'LORE', kind: 'product', title: 'Лор', status: '' });
    expect(r.fields).toMatchObject({ parent: ['AIDA'], children: ['LORE-M'], components: ['HND', 'SEIDRKIT'], project: ['AIDA/UnlimitedLORE'] });
    expect(productRecord({ code: 'X' }).title, 'без подписи — код').toBe('X');
  });

  it('боль, выгода, работа: акторы и «заявлено / снимает»', () => {
    expect(painRecord({ pain_id: 'PAIN-1', title: 'Медленно', severity: 'high', actor_ids: ['ACT-1'], addressed_by: 2, relieved_by: 0 }))
      .toMatchObject({ id: 'PAIN-1', kind: 'pain', title: 'Медленно', fields: { severity: 'high', actors: ['ACT-1'], claimed: 2, relieved: 0 } });
    expect(gainRecord({ gain_id: 'GAIN-1', title: 'Быстро', rank: 'top', actor_ids: [], promised_by: 1, delivered_by: 1 }))
      .toMatchObject({ id: 'GAIN-1', kind: 'gain', fields: { rank: 'top', claimed: 1, delivered: 1 } });
    expect(jobRecord({ job_id: 'JOB-1', title: 'Планировать', kind: 'functional', importance: 'high', helped_by: 3, performed_by: 1 }))
      .toMatchObject({ id: 'JOB-1', kind: 'job', fields: { job_kind: 'functional', importance: 'high', claimed: 3, performed: 1 } });
  });

  it('роль: вид актора — своим полем (kind записи занят видом kit)', () => {
    const r = actorRecord({ actor_id: 'ACT-1', name: 'Владелица', kind: 'human-role', projects: ['P'], uc_count: 4 });
    expect(r).toMatchObject({ id: 'ACT-1', kind: 'actor', title: 'Владелица', fields: { actor_kind: 'human-role', project: ['P'], ucs: 4 } });
  });

  it('компонент несёт свои продукты (IN_PRODUCT) — по ним красится запись', () => {
    expect(componentRecord({ component_id: 'HND', products: ['LORE'] }).fields.products).toEqual(['LORE']);
  });
});
