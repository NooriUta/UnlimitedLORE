// SPRINT_LORE_PROJECT_SCOPE/PS-PRODUCT-FILTER (владелица 21.11.2026): верхний фильтр — по продукту; продукт —
// логическая группа проектов, сам фильтр раскрывает бэкенд (scope_products). Здесь — список продуктов для шапки.
import { describe, expect, it } from 'vitest';
import { loadProductScope } from './loadProductScope';

const rows = [
  { code: 'HARPA', label_ru: 'Харпа', kind: ['tech', 'service'], git_projects: ['AIDA/core-services', 'NooriUta/UnlimitedLORE'] },
  { code: 'OMILORE', label_ru: null, kind: ['tech'], git_projects: ['NooriUta/UnlimitedLORE'] },
  { code: 'FREYJA', label_ru: 'Freyja', kind: ['service'], git_projects: [] },
  { code: 'OFF', label_ru: 'Снят', kind: ['tech'], git_projects: ['X/y'], is_active: false },
];
const fetch = (async () => ({ rows })) as never;

describe('продукты для верхнего фильтра', () => {
  it('сначала технологические, потом сервисные; снятые с поддержки не показываются', async () => {
    const d = await loadProductScope({ fetch, me: async () => ['NooriUta/UnlimitedLORE'] });
    expect(d.rows.map(r => r.id)).toEqual(['HARPA', 'OMILORE', 'FREYJA']);
  });
  it('подсказка — проекты продукта без организации; без проектов — так и сказано', async () => {
    const d = await loadProductScope({ fetch, me: async () => [] });
    expect(d.rows.find(r => r.id === 'HARPA')?.hint).toBe('core-services · UnlimitedLORE');
    expect(d.rows.find(r => r.id === 'FREYJA')?.hint).toBe('без проекта');
  });
  it('название — подпись продукта, нет подписи — код', async () => {
    const d = await loadProductScope({ fetch, me: async () => [] });
    expect(d.rows.find(r => r.id === 'HARPA')?.title).toBe('Харпа');
    expect(d.rows.find(r => r.id === 'OMILORE')?.title).toBe('OMILORE');
  });
  it('«мой» — продукт хотя бы одного моего проекта; число своих — по ответу сервера', async () => {
    const d = await loadProductScope({ fetch, me: async () => ['NooriUta/UnlimitedLORE'] });
    expect(d.rows.filter(r => r.mine).map(r => r.id)).toEqual(['HARPA', 'OMILORE']);
    expect(d.mine).toBe('known');
    expect(d.mineCount).toBe(2);
  });
  it('мои проекты не проверены — «мои» неизвестно, список остаётся', async () => {
    const d = await loadProductScope({ fetch, me: async () => { throw new Error('500'); } });
    expect(d.mine).toBe('unknown');
    expect(d.rows).toHaveLength(3);
  });
});
