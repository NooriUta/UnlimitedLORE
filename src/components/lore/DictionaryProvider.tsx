// ADR-LORE-012: single-load cache of KnowDictEntry values, exposed via context.
// Loads the whole `dictionary` slice once, groups by dict_type (active rows,
// sorted by sort_order). Consumers read one domain with useDictionary(dict_type)
// and fall back to their existing static maps when the domain is absent — so an
// older backend without the slice (returns error → empty cache) degrades cleanly.

import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { fetchLoreSlice, type DictEntry } from '../../api/lore';

interface DictionaryState {
  byType: Record<string, DictEntry[]>;
  loading: boolean;
}

const DictionaryContext = createContext<DictionaryState>({ byType: {}, loading: true });

export function DictionaryProvider({ children }: { children: ReactNode }) {
  const [byType, setByType] = useState<Record<string, DictEntry[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreSlice<DictEntry>('dictionary', undefined, ctrl.signal)
      .then(rows => {
        const m: Record<string, DictEntry[]> = {};
        rows
          .filter(r => r.is_active !== false)
          .forEach(r => { (m[r.dict_type] ??= []).push(r); });
        Object.values(m).forEach(list =>
          list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
        setByType(m);
        setLoading(false);
      })
      // No dictionary slice (older backend) or a transient error → empty cache;
      // consumers keep their static fallbacks. Never surfaces as a page error.
      .catch(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  const value = useMemo(() => ({ byType, loading }), [byType, loading]);
  return <DictionaryContext.Provider value={value}>{children}</DictionaryContext.Provider>;
}

/**
 * One dictionary domain (e.g. 'priority', 'sprint_status'). Returns the ordered
 * entries plus a code→entry lookup. Empty until loaded / when the domain is
 * absent — callers should fall back to their static map in that case.
 */
export function useDictionary(dictType: string): {
  entries: DictEntry[];
  byCode: Record<string, DictEntry>;
  loading: boolean;
} {
  const { byType, loading } = useContext(DictionaryContext);
  return useMemo(() => {
    const entries = byType[dictType] ?? [];
    const byCode: Record<string, DictEntry> = {};
    entries.forEach(e => { byCode[e.code] = e; });
    return { entries, byCode, loading };
  }, [byType, dictType, loading]);
}
