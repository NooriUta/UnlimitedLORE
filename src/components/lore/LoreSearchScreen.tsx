import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSearch, type LoreSearchResult } from '../../api/lore';
import { SearchInput, FilterDimensionMulti, type FilterOption } from './FilterPrimitives';
import { EmptyState } from './EmptyState';
import { searchHitHref, typeLabel } from '../../api/searchRoutes';

// ── SRCH-05 UI: сквозной поиск с плашками типов и фасетами (ADR-LORE-033) ───
// Эталон — одобренный прототип docs/prototypes/search-facets-srch05.html:
// строка запроса → три оси мультивыбора (тип / компонент / проект) → баннер
// покрытия → список хитов (позиция, бар ранга, тип-чип, ref_id, «где совпало»,
// заголовок, score, строка привязок с пометкой «выведено из …»).
//
// СЧЁТЧИКИ ФАСЕТОВ — СЕРВЕРНЫЕ (by_type / by_component из ответа), а не
// клиентский пересчёт: сервер видит всю выборку ветки (до capped_at), клиент —
// только страницу. useFacetFilters здесь сознательно НЕ используется — он
// фильтрует уже загруженный массив, что противоречит серверной модели фасетов
// («фильтр туда, куда ходим», отсечение на уровне ветки unionall).




export function LoreSearchScreen() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [comps, setComps] = useState<Set<string>>(new Set());
  const [projs, setProjs] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<LoreSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Счётчики держим от ПОСЛЕДНЕГО безфасетного ответа: как в прототипе,
  // чипы показывают состав выдачи по запросу, а не тают под своим же фильтром.
  const [baseCounts, setBaseCounts] = useState<LoreSearchResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResult(null); setBaseCounts(null); setError(null); return; }
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      const facetsActive = types.size > 0 || comps.size > 0 || projs.size > 0;
      // Проект — клиентская ось (по полю projects хита): у сервера один project,
      // а прототип требует мультивыбор; хитов на страницу немного.
      fetchLoreSearch({
        q,
        types: [...types],
        components: [...comps],
        limit: 50,
      }, ac.signal)
        .then(r => {
          setResult(r); setError(null);
          if (!facetsActive) setBaseCounts(r);
        })
        .catch(e => { if (e?.name !== 'AbortError') setError(String(e?.message ?? e)); })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, types, comps, projs]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void) => (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setter(next);
  };

  const counts = baseCounts ?? result;

  const typeOptions: FilterOption[] = useMemo(() => {
    const seen = Object.keys(counts?.by_type ?? {});
    const all = [...new Set([...seen, ...types])];
    return all
      .sort((a, b) => (counts?.by_type?.[b] ?? 0) - (counts?.by_type?.[a] ?? 0))
      .map(v => ({ value: v, label: typeLabel(v) }));
  }, [counts, types]);

  const compOptions: FilterOption[] = useMemo(() => {
    const seen = Object.keys(counts?.by_component ?? {});
    const all = [...new Set([...seen, ...comps])];
    return all
      .sort((a, b) => (counts?.by_component?.[b] ?? 0) - (counts?.by_component?.[a] ?? 0))
      .slice(0, 14)
      .map(v => ({ value: v, label: v }));
  }, [counts, comps]);

  const projCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const h of result?.hits ?? []) for (const p of h.projects ?? []) m[p] = (m[p] ?? 0) + 1;
    return m;
  }, [result]);
  const projOptions: FilterOption[] = useMemo(
    () => Object.keys(projCounts).sort((a, b) => projCounts[b] - projCounts[a])
      .map(v => ({ value: v, label: v })),
    [projCounts]);

  const hits = useMemo(() => {
    let hs = result?.hits ?? [];
    if (projs.size > 0) hs = hs.filter(h => (h.projects ?? []).some(p => projs.has(p)));
    return hs;
  }, [result, projs]);

  const maxScore = hits.length ? hits[0].score : 1;
  const inherited = hits.filter(h => h.inherited_from).length;
  const bare = hits.filter(h => !h.components?.length).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SearchInput
        value={query} onChange={setQuery} maxWidth={480}
        placeholder={t('lore.search.placeholder', 'Поиск по всему LORE — морфология, тела, префикс…')}
        ariaLabel={t('lore.search.aria', 'Сквозной поиск')} />

      {counts && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FilterDimensionMulti label={t('lore.search.types', 'тип')}
            options={typeOptions} selected={types}
            onToggle={toggle(types, setTypes)} counts={counts.by_type} />
          <FilterDimensionMulti label={t('lore.search.components', 'компонент')}
            options={compOptions} selected={comps}
            onToggle={toggle(comps, setComps)} counts={counts.by_component} />
          {projOptions.length > 0 && (
            <FilterDimensionMulti label={t('lore.search.projects', 'проект')}
              options={projOptions} selected={projs}
              onToggle={toggle(projs, setProjs)} counts={projCounts} />
          )}
        </div>
      )}

      {result && hits.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--t3)' }}>
          {t('lore.search.coverage', 'привязка к компонентам')}: {inherited > 0 &&
            <>{inherited} {t('lore.search.inferred', 'выведено от родителя')} · </>}
          {bare} {t('lore.search.bare', 'без компонента')} ·
          {' '}{result.took_ms} ms
        </div>
      )}

      {error && <EmptyState icon="help" message={t('lore.search.error', 'Поиск не ответил')} hint={error} />}
      {!error && query.trim().length >= 2 && !loading && hits.length === 0 && result && (
        <EmptyState icon="magnifying-glass"
          message={t('lore.search.empty', 'Под эти фильтры ничего не попало')}
          hint={t('lore.search.emptyHint', 'Снимите фасеты или упростите запрос')} />
      )}

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hits.map((h, i) => (
          <li key={h.type + h.ref_id}
              style={{ position: 'relative', padding: '8px 10px 10px 34px',
                       background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 8 }}>
            <span style={{ position: 'absolute', left: 10, top: 10, fontSize: 12,
                           color: 'var(--t3)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
            {/* Бар ранга: доля от лучшего хита текущей выдачи, как в прототипе. */}
            <span aria-hidden style={{ position: 'absolute', left: 0, bottom: 0,
              height: 2, width: `${Math.max(4, (h.score / maxScore) * 100)}%`,
              background: 'var(--acc)', opacity: .5, borderRadius: 2 }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999,
                             background: 'color-mix(in srgb, var(--acc) 14%, transparent)',
                             color: 'var(--t2)' }}>{typeLabel(h.type)}</span>
              <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12, color: 'var(--t3)' }}>{h.ref_id}</span>
              <span style={{ fontSize: 11, color: h.matched_field === 'title' || h.matched_field === 'name'
                  ? 'var(--ok, #4caf72)' : 'var(--t3)' }}>
                {h.matched_field === 'title' || h.matched_field === 'name'
                  ? t('lore.search.inTitle', 'заголовок') : h.matched_field}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)',
                             fontVariantNumeric: 'tabular-nums' }}>{h.score.toFixed(3)}</span>
            </div>
            <a href={searchHitHref(h.type, h.ref_id)} style={{ display: 'block', marginTop: 2, color: 'var(--t1)',
                                          textDecoration: 'none', fontWeight: 600 }}>
              {h.title ?? h.ref_id}
            </a>
            {h.snippet && (
              <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--t2)' }}>{h.snippet}</div>
            )}
            {(h.components?.length > 0 || h.projects?.length > 0) && (
              <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--t3)' }}>
                {h.components?.length > 0 && <>
                  {h.components.join(' · ')}
                  {h.inherited_from && <i> — {t('lore.search.inferredFrom', 'выведено из')} {h.inherited_from}</i>}
                </>}
                {h.components?.length > 0 && h.projects?.length > 0 && ' · '}
                {h.projects?.join(' · ')}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
