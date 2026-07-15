import { describe, expect, it } from 'vitest';
import { matchTags, sortAdrs, NO_TAG, type AdrSortKey } from './LoreAdrList';

// Client-side ADR filter/sort logic (T01, SPRINT_LORE_UX_FILTERS_LINKS). The
// backend only returns the fields; combining/ordering happens here because
// slice compose() can't AND-join filters and ArcadeDB can't bind ORDER BY.

describe('matchTags', () => {
  it('matches everything when no tag selected', () => {
    expect(matchTags([], new Set())).toBe(true);
    expect(matchTags(['a'], new Set())).toBe(true);
  });

  it('NO_TAG sentinel matches only untagged ADRs', () => {
    expect(matchTags([], new Set([NO_TAG]))).toBe(true);
    expect(matchTags(['reconstruction'], new Set([NO_TAG]))).toBe(false);
  });

  it('matches when any of the ADR tags is selected (OR within dimension)', () => {
    expect(matchTags(['a', 'b'], new Set(['b']))).toBe(true);
    expect(matchTags(['a', 'b'], new Set(['c']))).toBe(false);
  });

  it('NO_TAG combined with a real tag matches either', () => {
    const sel = new Set([NO_TAG, 'a']);
    expect(matchTags([], sel)).toBe(true);      // untagged
    expect(matchTags(['a'], sel)).toBe(true);   // tagged with a
    expect(matchTags(['x'], sel)).toBe(false);  // tagged, but not a
  });
});

type Row = { adr_id: string; date_created: string | null; status: string | null; component: string | null };
const rows: Row[] = [
  { adr_id: 'ADR-HND-002',  date_created: '2026-05-02', status: 'ACCEPTED', component: 'HND' },
  { adr_id: 'ADR-HND-010',  date_created: '2026-05-02', status: 'ACCEPTED', component: 'HND' },
  { adr_id: 'ADR-LORE-001', date_created: '2026-07-06', status: 'PROPOSED', component: 'OMILORE' },
];
const ids = (rs: Row[]) => rs.map(r => r.adr_id);
const run = (key: AdrSortKey, dir: 'asc' | 'desc') => ids(sortAdrs(rows, key, dir));

describe('sortAdrs', () => {
  it('by date desc = newest first (the default)', () => {
    expect(run('date', 'desc')[0]).toBe('ADR-LORE-001');
  });

  it('by adr_id is numeric-aware within a family (002 before 010, not lexical)', () => {
    expect(run('id', 'asc')).toEqual(['ADR-HND-002', 'ADR-HND-010', 'ADR-LORE-001']);
  });

  it('direction flips the order', () => {
    expect(run('id', 'desc')).toEqual(['ADR-LORE-001', 'ADR-HND-010', 'ADR-HND-002']);
  });

  it('does not mutate the input array', () => {
    const before = ids(rows);
    sortAdrs(rows, 'status', 'asc');
    expect(ids(rows)).toEqual(before);
  });

  it('tolerates null sort fields', () => {
    const withNull: Row[] = [{ adr_id: 'ADR-X-1', date_created: null, status: null, component: null }, ...rows];
    expect(() => sortAdrs(withNull, 'date', 'desc')).not.toThrow();
  });
});
