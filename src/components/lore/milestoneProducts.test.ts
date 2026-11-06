import { describe, expect, it } from 'vitest';
import {
  NO_PRODUCT, isFrozenMilestone, milestonesOfProduct, productScope, unplannedOfProduct,
  type ProductRow,
} from './milestoneProducts';

/**
 * RM-P5 / RM-U2 / RM-U6 (прототип RM-U1 v4, «да» владелицы 06.11.2026):
 * карта вех строится по ПРОДУКТУ, подпродукты показываются внутри родителя,
 * история заморожена и в счёт открытой работы не входит, «вне плана» — открытые
 * спринты продукта без вехи.
 */
const P: ProductRow[] = [
  { code: 'AIDA', label_ru: 'AIDA', parent_code: [], sub_products: ['HOUND', 'SEIDR'], components: ['DALI', 'AIDA'] },
  { code: 'HOUND', label_ru: 'HOUND', parent_code: ['AIDA'], sub_products: [], components: ['HND'] },
  { code: 'SEIDR', label_ru: 'SEIDR', parent_code: ['AIDA'], sub_products: [], components: ['LOOM'] },
  { code: 'MIDGARD', label_ru: 'Мидгард', parent_code: [], sub_products: [], components: ['GLADSHEIM'] },
];
const ms = (id: string, products: string[], sprints: string[] = []) =>
  ({ milestone_id: id, label: id, week: null, date_display: null, goal_md: null, priority: null,
     products, direct_sprint_ids: sprints });
const sp = (id: string, status: string, components: string[]) =>
  ({ sprint_id: id, name: id, status_raw: status, components });

describe('milestoneProducts', () => {
  it('подпродукты входят в карту родителя, но не наоборот', () => {
    expect([...productScope('AIDA', P)].sort()).toEqual(['AIDA', 'HOUND', 'SEIDR']);
    expect([...productScope('HOUND', P)]).toEqual(['HOUND']);
  });

  it('веха подпродукта видна в карте AIDA; чужая — нет; «без продукта» — отдельно', () => {
    const M = [ms('M-AIDA-A1', ['AIDA']), ms('M-HOUND-H1', ['HOUND']), ms('M-MIDGARD-D2', ['MIDGARD']), ms('M-X', [])];
    expect(milestonesOfProduct(M, 'AIDA', P).map(m => m.milestone_id)).toEqual(['M-AIDA-A1', 'M-HOUND-H1']);
    expect(milestonesOfProduct(M, 'HOUND', P).map(m => m.milestone_id)).toEqual(['M-HOUND-H1']);
    expect(milestonesOfProduct(M, NO_PRODUCT, P).map(m => m.milestone_id)).toEqual(['M-X']);
    expect(milestonesOfProduct(M, null, P)).toHaveLength(4);
  });

  it('заморожены забег M0–M7 и вехи истории по сериям релизов, прогноз — нет', () => {
    for (const id of ['M0', 'M7', 'M-AIDA-HIST-1.3', 'M-GLADSHEIM-HIST-0.1-0.6']) expect(isFrozenMilestone(id)).toBe(true);
    for (const id of ['M-AIDA-A1', 'M-LORE-CLIENT-SAFE', 'M8', 'M10']) expect(isFrozenMilestone(id)).toBe(false);
  });

  it('«вне плана»: открытые спринты компонентов продукта (с подпродуктами) без вехи', () => {
    const M = [ms('M-AIDA-A1', ['AIDA'], ['SPRINT_IN_PLAN'])];
    const S = [
      sp('SPRINT_IN_PLAN', '📋 PLANNED', ['DALI']),
      sp('SPRINT_FREE', '🔄 IN PROGRESS', ['HND']),
      sp('SPRINT_DONE', '✅ DONE', ['DALI']),
      sp('SPRINT_CANCELLED', '🚫 CANCELLED', ['DALI']),
      sp('SPRINT_OTHER', '📋 PLANNED', ['GLADSHEIM']),
    ];
    expect(unplannedOfProduct(S, M, 'AIDA', P).map(s => s.sprint_id)).toEqual(['SPRINT_FREE']);
    expect(unplannedOfProduct(S, M, 'MIDGARD', P).map(s => s.sprint_id)).toEqual(['SPRINT_OTHER']);
    // без выбора продукта — все открытые без вехи
    expect(unplannedOfProduct(S, M, null, P).map(s => s.sprint_id).sort()).toEqual(['SPRINT_FREE', 'SPRINT_OTHER']);
  });
});
