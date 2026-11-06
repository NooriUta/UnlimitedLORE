import { describe, expect, it } from 'vitest';
import { featureLineageOf } from './featureLineage';

// SPRINT_LORE_PRODUCT_BACKLOG/AN-09 · срез G «граф линейки» по ребру BUILDS_ON
// (D-2026-LORE-FEATURE-BUILDS-ON-EDGE): опирается на → открывает дорогу.
describe('featureLineageOf', () => {
  it('рёбра из обеих сторон сводятся без дублей', () => {
    const r = featureLineageOf([
      { uc_id: 'FEAT-B', title: 'B', builds_on_ids: ['FEAT-A'], enables_ids: [] },
      { uc_id: 'FEAT-A', title: 'A', builds_on_ids: [], enables_ids: ['FEAT-B'] },
    ]);
    expect(r.edges).toEqual([{ from: 'FEAT-B', to: 'FEAT-A' }]);
    expect(r.linked).toBe(2);
    expect(r.isolated).toEqual([]);
  });

  it('фичи без связей названы, а не потеряны', () => {
    const r = featureLineageOf([
      { uc_id: 'FEAT-A', title: 'A', builds_on_ids: null, enables_ids: null },
      { uc_id: 'FEAT-B', title: 'B', builds_on_ids: [null], enables_ids: [] },
    ]);
    expect(r.edges).toEqual([]);
    expect(r.isolated).toEqual(['FEAT-A', 'FEAT-B']);
  });

  it('основание линейки — фича, на которую опираются, а сама ни на что', () => {
    const r = featureLineageOf([
      { uc_id: 'FEAT-C', title: 'C', builds_on_ids: ['FEAT-B'], enables_ids: [] },
      { uc_id: 'FEAT-B', title: 'B', builds_on_ids: ['FEAT-A'], enables_ids: ['FEAT-C'] },
      { uc_id: 'FEAT-A', title: 'A', builds_on_ids: [], enables_ids: ['FEAT-B'] },
    ]);
    expect(r.foundations).toEqual(['FEAT-A']);
    expect(r.mermaid).toContain('FEAT-B --> FEAT-A');
  });
});
