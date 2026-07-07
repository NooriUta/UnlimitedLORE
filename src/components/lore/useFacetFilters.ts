import { useCallback, useMemo, useState } from 'react';

// Generic facet-filter engine (SPRINT_LORE_UX_OPTIMIZATION T31/T33).
// Same algorithm as the approved prototype (docs/prototypes/two-tier-filter.html):
// each dimension's count/pass check can be computed "excluding itself" so chip
// badges show what WOULD match if you added that value — the same principle
// already used by StatusCountBar (LoreSprintDetail.tsx:291-330), generalized
// to every dimension across both the global and local tiers at once (a single
// hook instance spans both tiers, because a count for a global dimension must
// still respect active local filters and vice versa).

export type FacetDimType = 'multi' | 'single' | 'bool';

export interface FacetDim<T> {
  key: string;
  tier: 'global' | 'local';
  type: FacetDimType;
  getValue: (item: T) => string | boolean | null | undefined;
  /** global-tier only: this dimension's value survives resetSurface() instead of being cleared. */
  persist?: boolean;
}

interface FilterState {
  query: string;
  multi: Record<string, Set<string>>;
  single: Record<string, string | null>;
  bool: Record<string, boolean>;
}

function emptyState<T>(dims: FacetDim<T>[]): FilterState {
  const s: FilterState = { query: '', multi: {}, single: {}, bool: {} };
  for (const d of dims) {
    if (d.type === 'multi') s.multi[d.key] = new Set();
    else if (d.type === 'single') s.single[d.key] = null;
    else s.bool[d.key] = false;
  }
  return s;
}

export interface UseFacetFiltersResult<T> {
  query: string;
  setQuery: (q: string) => void;
  multi: Record<string, Set<string>>;
  single: Record<string, string | null>;
  bool: Record<string, boolean>;
  toggleMulti: (key: string, value: string) => void;
  setSingle: (key: string, value: string | null) => void;
  setBool: (key: string, value: boolean) => void;
  /** Matches every active filter across both tiers, optionally skipping one dimension — the facet-count engine. */
  passExcept: (item: T, skipKey?: string) => boolean;
  /** How many items would match if `key` were unconstrained (all other active filters still apply). */
  countFor: (key: string, value: string | boolean) => number;
  filtered: T[];
  activeCount: (tier: 'global' | 'local') => number;
  /** Clears everything (both tiers). */
  resetAll: () => void;
  /** Clears one tier's dimensions only (global-tier dims flagged persist:true are kept). */
  resetTier: (tier: 'global' | 'local') => void;
  /** Call when switching to a different surface/section: resets local + non-persisted global dims. */
  resetSurface: () => void;
}

export function useFacetFilters<T>(
  items: T[],
  dims: FacetDim<T>[],
  searchText?: (item: T) => string,
): UseFacetFiltersResult<T> {
  const [state, setState] = useState<FilterState>(() => emptyState(dims));
  const dimsByKey = useMemo(() => new Map(dims.map(d => [d.key, d])), [dims]);

  const matchesDim = useCallback((d: FacetDim<T>, item: T): boolean => {
    const v = d.getValue(item);
    if (d.type === 'multi') {
      const sel = state.multi[d.key];
      return !sel || sel.size === 0 || (typeof v === 'string' && sel.has(v));
    }
    if (d.type === 'single') {
      const sel = state.single[d.key];
      return !sel || v === sel;
    }
    return !state.bool[d.key] || v === true;
  }, [state]);

  const passExcept = useCallback((item: T, skipKey?: string): boolean => {
    const q = state.query.trim().toLowerCase();
    if (q && searchText && !searchText(item).toLowerCase().includes(q)) return false;
    for (const d of dims) {
      if (d.key === skipKey) continue;
      if (!matchesDim(d, item)) return false;
    }
    return true;
  }, [dims, state.query, matchesDim, searchText]);

  const countFor = useCallback((key: string, value: string | boolean): number => {
    const d = dimsByKey.get(key);
    if (!d) return 0;
    return items.filter(it => passExcept(it, key) && d.getValue(it) === value).length;
  }, [items, dimsByKey, passExcept]);

  const filtered = useMemo(() => items.filter(it => passExcept(it)), [items, passExcept]);

  const activeCount = useCallback((tier: 'global' | 'local'): number => {
    let n = 0;
    if (tier === 'global' && state.query) n++;
    for (const d of dims) {
      if (d.tier !== tier) continue;
      if (d.type === 'multi') n += state.multi[d.key]?.size ?? 0;
      else if (d.type === 'single') { if (state.single[d.key]) n++; }
      else if (state.bool[d.key]) n++;
    }
    return n;
  }, [dims, state]);

  const setQuery = useCallback((q: string) => setState(s => ({ ...s, query: q })), []);

  const toggleMulti = useCallback((key: string, value: string) => setState(s => {
    const next = new Set(s.multi[key] ?? []);
    next.has(value) ? next.delete(value) : next.add(value);
    return { ...s, multi: { ...s.multi, [key]: next } };
  }), []);

  const setSingle = useCallback((key: string, value: string | null) => setState(s => ({
    ...s, single: { ...s.single, [key]: s.single[key] === value ? null : value },
  })), []);

  const setBool = useCallback((key: string, value: boolean) => setState(s => ({
    ...s, bool: { ...s.bool, [key]: value },
  })), []);

  const resetAll = useCallback(() => setState(emptyState(dims)), [dims]);

  const resetTier = useCallback((tier: 'global' | 'local') => setState(s => {
    const next: FilterState = { ...s, multi: { ...s.multi }, single: { ...s.single }, bool: { ...s.bool } };
    if (tier === 'global') next.query = '';
    for (const d of dims) {
      if (d.tier !== tier) continue;
      if (d.type === 'multi') next.multi[d.key] = new Set();
      else if (d.type === 'single') next.single[d.key] = null;
      else next.bool[d.key] = false;
    }
    return next;
  }), [dims]);

  const resetSurface = useCallback(() => setState(s => {
    const next: FilterState = { ...s, multi: { ...s.multi }, single: { ...s.single }, bool: { ...s.bool } };
    for (const d of dims) {
      if (d.tier === 'local') {
        if (d.type === 'multi') next.multi[d.key] = new Set();
        else if (d.type === 'single') next.single[d.key] = null;
        else next.bool[d.key] = false;
      } else if (d.tier === 'global' && !d.persist) {
        if (d.type === 'multi') next.multi[d.key] = new Set();
        else if (d.type === 'single') next.single[d.key] = null;
        else next.bool[d.key] = false;
      }
    }
    return next;
  }), [dims]);

  return {
    query: state.query, setQuery,
    multi: state.multi, single: state.single, bool: state.bool,
    toggleMulti, setSingle, setBool,
    passExcept, countFor, filtered, activeCount,
    resetAll, resetTier, resetSurface,
  };
}
