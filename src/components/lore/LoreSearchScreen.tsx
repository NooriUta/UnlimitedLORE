import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSearch, type LoreSearchResult } from '../../api/lore';
import { SearchInput, FilterDimensionMulti, type FilterOption } from './FilterPrimitives';
import { EmptyState } from './EmptyState';
import { searchHitHref, typeLabel, typeHue } from '../../api/searchRoutes';

// ── SRCH-05/09 UI: сквозной поиск с плашками типов и фасетами (ADR-LORE-033) ─
// Эталон — одобренный прототип docs/prototypes/search-facets-srch05.html и
// search-ranking-srch05.html: строка запроса → разобранное выражение → три оси
// мультивыбора → баннер покрытия → список хитов (позиция, бар ранга, цветной
// тип-чип, ref_id, «где совпало», заголовок, РАЗЛОЖЕННЫЙ ранг, привязки с
// подписями) → пагинация → оговорки о том, чего поиск не умеет.
//
// СЧЁТЧИКИ ФАСЕТОВ — СЕРВЕРНЫЕ (by_type / by_component / by_project), а не
// клиентский пересчёт: сервер видит всю выборку ветки (до capped_at), клиент —
// только страницу. useFacetFilters здесь сознательно НЕ используется — он
// фильтрует уже загруженный массив, что противоречит серверной модели фасетов
// («фильтр туда, куда ходим», отсечение на уровне ветки unionall).

export const PAGE = 50;

const MODES = ['smart', 'exact', 'fuzzy'] as const;
type Mode = typeof MODES[number];

/**
 * Границы текущей страницы. Вынесено из разметки, потому что именно здесь
 * ошибка не видна глазом: «показаны 51–100 из 80» выглядит правдоподобно.
 *
 * `to` ограничен `total`, а не `offset + page`: на последней странице хитов
 * меньше страницы, и без ограничения UI обещал бы записи, которых нет.
 */
export function pageBounds(total: number, offset: number, page = PAGE) {
  return {
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + page, total),
    hasPrev: offset > 0,
    hasNext: offset + page < total,
  };
}

/**
 * Состав выдачи по привязке к компонентам — для баннера покрытия.
 *
 * `bare` считается отдельно от `inherited`, потому что это разные вещи:
 * выведенная привязка есть (просто получена от родителя), а у голого хита её
 * нет вовсе — и любой фильтр по компоненту его скроет. Слить их в один
 * счётчик значило бы обещать связь там, где её не существует.
 */
export function coverageOf(hits: { inherited_from: string | null; components?: string[] }[]) {
  return {
    inherited: hits.filter(h => h.inherited_from).length,
    bare: hits.filter(h => !h.components?.length).length,
  };
}

export function LoreSearchScreen() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [comps, setComps] = useState<Set<string>>(new Set());
  const [projs, setProjs] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('smart');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<LoreSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Счётчики держим от ПОСЛЕДНЕГО безфасетного ответа: как в прототипе,
  // чипы показывают состав выдачи по запросу, а не тают под своим же фильтром.
  const [baseCounts, setBaseCounts] = useState<LoreSearchResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Подписи режимов — ЛИТЕРАЛАМИ, а не t(`lore.search.mode.${m}`). Собранный
  // на лету ключ проверка покрытия локалей (I18N-03) не видит: она читает
  // исходник, а не выполняет его. Такой ключ пропал бы из обеих локалей молча —
  // ровно тот случай, ради которого проверку и переворачивали.
  const modeLabel: Record<Mode, string> = {
    smart: t('lore.search.modeSmart', 'умный'),
    exact: t('lore.search.modeExact', 'точный'),
    fuzzy: t('lore.search.modeFuzzy', 'нечёткий'),
  };
  const modeHint: Record<Mode, string> = {
    smart: t('lore.search.modeSmartHint', 'Каждое слово идёт как (слово OR слово*) — морфология плюс префикс'),
    exact: t('lore.search.modeExactHint', 'Только точные формы слов, без префикса'),
    fuzzy: t('lore.search.modeFuzzyHint', 'Допускает опечатки — шире, но шумнее'),
  };

  // Смена запроса, фасета или режима возвращает на первую страницу. Иначе
  // пользователь остаётся на 3-й странице ДРУГОЙ выдачи и видит пустоту,
  // которую невозможно отличить от «ничего не нашлось».
  useEffect(() => { setOffset(0); }, [query, types, comps, projs, mode]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResult(null); setBaseCounts(null); setError(null); return; }
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      const facetsActive = types.size > 0 || comps.size > 0 || projs.size > 0;
      fetchLoreSearch({
        q,
        types: [...types],
        components: [...comps],
        // SRCH-10: проекты уходят НА СЕРВЕР — фильтр отсекает на уровне ветки,
        // а не выбрасывает уже загруженную страницу.
        projects: [...projs],
        limit: PAGE,
        offset,
        mode,
      }, ac.signal)
        .then(r => {
          setResult(r); setError(null);
          if (!facetsActive && offset === 0) setBaseCounts(r);
        })
        .catch(e => { if (e?.name !== 'AbortError') setError(String(e?.message ?? e)); })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, types, comps, projs, mode, offset]);

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

  // SRCH-10: ось проекта СЕРВЕРНАЯ, как тип и компонент. Раньше она считалась
  // по текущей странице выдачи — счётчики врали за пределами первых 50 хитов,
  // а серверный фильтр по проекту не задействовался вовсе.
  const projOptions: FilterOption[] = useMemo(() => {
    const seen = Object.keys(counts?.by_project ?? {});
    const all = [...new Set([...seen, ...projs])];
    return all
      .sort((a, b) => (counts?.by_project?.[b] ?? 0) - (counts?.by_project?.[a] ?? 0))
      .map(v => ({ value: v, label: v }));
  }, [counts, projs]);

  const hits = result?.hits ?? [];

  const maxScore = hits.length ? hits[0].score : 1;
  const { inherited, bare } = coverageOf(hits);

  const total = result?.total_collected ?? 0;
  const { from: pageFrom, to: pageTo, hasPrev, hasNext } = pageBounds(total, offset);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <SearchInput
          value={query} onChange={setQuery} maxWidth={480}
          placeholder={t('lore.search.placeholder', 'Поиск по всему LORE — морфология, тела, префикс…')}
          ariaLabel={t('lore.search.aria', 'Сквозной поиск')} />

        {/* Режим разбора. API умел его с самого начала, а UI не предлагал —
            то есть точный поиск по фразе был недоступен, хотя работал. */}
        <div role="group" aria-label={t('lore.search.modeAria', 'Режим поиска')}
             style={{ display: 'flex', gap: 2 }}>
          {MODES.map(m => (
            <button key={m} type="button" onClick={() => setMode(m)}
              aria-pressed={mode === m}
              title={modeHint[m]}
              style={{
                fontSize: 11, padding: '3px 9px', cursor: 'pointer',
                border: '1px solid var(--b1)',
                borderRadius: m === 'smart' ? '6px 0 0 6px' : m === 'fuzzy' ? '0 6px 6px 0' : 0,
                background: mode === m ? 'color-mix(in srgb, var(--acc) 18%, transparent)' : 'var(--s1)',
                color: mode === m ? 'var(--t1)' : 'var(--t3)',
              }}>
              {modeLabel[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Во что превратился запрос. Строку строит сервер (D2), и больше она
          нигде не видна: без показа расхождение «что я искал» и «что искали за
          меня» проверить нечем — а именно оно объясняет неожиданную выдачу. */}
      {result?.lucene && (
        <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>
          {t('lore.search.goesToIndex', 'уходит в индекс как')}{' '}
          <code style={{ fontFamily: 'var(--mono, monospace)', color: 'var(--t2)' }}>{result.lucene}</code>
        </div>
      )}

      {counts && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FilterDimensionMulti label={t('lore.search.types', 'тип')}
            options={typeOptions} selected={types}
            onToggle={toggle(types, setTypes)} counts={counts.by_type} />
          <FilterDimensionMulti label={t('lore.search.components', 'компонент')}
            options={compOptions} selected={comps}
            onToggle={toggle(comps, setComps)} counts={counts.by_component} />
          {/* Пустая ось РИСУЕТСЯ с пометкой. Молча исчезая, она читалась как
              «фильтра по проекту не существует», хотя ось есть — значений нет. */}
          {projOptions.length > 0 ? (
            <FilterDimensionMulti label={t('lore.search.projects', 'проект')}
              options={projOptions} selected={projs}
              onToggle={toggle(projs, setProjs)} counts={counts.by_project} />
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 }}>
              <span style={{ color: 'var(--t3)', minWidth: 74 }}>{t('lore.search.projects', 'проект')}</span>
              <span style={{ color: 'var(--t3)', fontStyle: 'italic' }}>
                {t('lore.search.noValues', '— нет значений —')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* SRCH-10: упавшая ветка — это «здесь НЕ ИСКАЛИ», а не «здесь ничего нет».
          Раньше сервер клал в фасет −1, и UI рисовал его как счётчик: выдача
          выглядела полной, хотя часть корпуса не просматривалась вовсе. */}
      {result && result.warnings?.length > 0 && (
        <div style={{
          fontSize: 12, color: 'var(--wrn)', border: '1px solid var(--wrn)',
          borderRadius: 6, padding: '6px 10px',
          background: 'color-mix(in srgb, var(--wrn) 10%, transparent)',
        }}>
          {t('lore.search.partial', 'Выдача неполная — поиск не отработал по типам')}:
          {' '}{result.warnings.map(w => typeLabel(w.type)).join(', ')}
        </div>
      )}

      {result && hits.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--t3)' }}>
          <b style={{ color: 'var(--t2)' }}>{t('lore.search.found', 'найдено')}: {total}</b>
          {total > PAGE && <> · {t('lore.search.shown', 'показаны')} {pageFrom}–{pageTo}</>}
          {inherited > 0 && <> · {inherited} {t('lore.search.inferred', 'выведено от родителя')}</>}
          {' '}· {bare} {t('lore.search.bare', 'без компонента')}
          {bare > 0 && <> — <i>{t('lore.search.bareWarn', 'их скроет любой фильтр по компоненту')}</i></>}
          {' '}· {result.took_ms} ms
          {total >= result.capped_at && <> · <span style={{ color: 'var(--wrn)' }}>
            {t('lore.search.capped', 'упёрлось в потолок ветки — сузьте запрос')}
          </span></>}
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
                           color: 'var(--t3)', fontVariantNumeric: 'tabular-nums' }}>
              {offset + i + 1}
            </span>
            {/* Бар ранга: доля от лучшего хита текущей выдачи, как в прототипе. */}
            <span aria-hidden style={{ position: 'absolute', left: 0, bottom: 0,
              height: 2, width: `${Math.max(4, (h.score / maxScore) * 100)}%`,
              background: typeHue(h.type), opacity: .5, borderRadius: 2 }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999,
                             background: `color-mix(in srgb, ${typeHue(h.type)} 16%, transparent)`,
                             color: typeHue(h.type) }}>{typeLabel(h.type)}</span>
              <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12, color: 'var(--t3)' }}>{h.ref_id}</span>
              <span style={{ fontSize: 11, color: h.matched_field === 'title' || h.matched_field === 'name'
                  ? 'var(--ok, #4caf72)' : 'var(--t3)' }}>
                {h.matched_field === 'title' || h.matched_field === 'name'
                  ? t('lore.search.inTitle', 'заголовок') : h.matched_field}
              </span>
              {/* Ранг РАЗЛОЖЕН. Итоговое число само по себе необъяснимо: оно не
                  отвечает, почему задача выше ADR. Видно, что это две величины —
                  совпадение текста и приоритет типа, — и вторую задаём мы. */}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)',
                             fontVariantNumeric: 'tabular-nums' }}
                    title={t('lore.search.mathHint', 'BM25 (доля от лучшего в своём типе) × приоритет типа')}>
                <b style={{ color: 'var(--t2)' }}>{h.score.toFixed(3)}</b>
                {' '}= {h.bm25?.toFixed(3)} × {h.type_priority?.toFixed(2)}
              </span>
            </div>
            <a href={searchHitHref(h.type, h.ref_id)} style={{ display: 'block', marginTop: 2, color: 'var(--t1)',
                                          textDecoration: 'none', fontWeight: 600 }}>
              {/* Отсутствующий заголовок называется отсутствующим. Подстановка
                  ref_id вместо него выглядела как «заголовок такой», и пропажу
                  данных было не отличить от данных. */}
              {h.title ?? <i style={{ color: 'var(--t3)', fontWeight: 400 }}>
                {t('lore.search.noTitle', '— без заголовка —')}
              </i>}
            </a>
            {h.snippet && (
              <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--t2)' }}>{h.snippet}</div>
            )}
            {(h.components?.length > 0 || h.projects?.length > 0) && (
              <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--t3)' }}>
                {/* Подписи обязательны: раньше компонент и проект шли одной
                    строкой через «·», и какое значение чем является — не
                    читалось. Список без подписи — это загадка, а не связь. */}
                {h.components?.length > 0 && <>
                  {t('lore.search.componentLabel', 'компонент')}: {h.components.join(' · ')}
                  {h.inherited_from && <i> — {t('lore.search.inferredFrom', 'выведено из')} {h.inherited_from}</i>}
                </>}
                {h.components?.length > 0 && h.projects?.length > 0 && <br />}
                {h.projects?.length > 0 && <>
                  {t('lore.search.projectLabel', 'проект')}: {h.projects.join(' · ')}
                </>}
              </div>
            )}
          </li>
        ))}
      </ol>

      {/* Пагинация листает РЕАЛЬНЫЙ offset: сервер умел его с самого начала, а
          UI просил 50 и молчал об остальных — «найдено 300» при 50 на экране
          читалось как поломка. */}
      {result && total > PAGE && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <button type="button" disabled={!hasPrev || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
            style={pagerStyle(!hasPrev || loading)}>
            ← {t('lore.search.prev', 'назад')}
          </button>
          <span style={{ fontSize: 12, color: 'var(--t3)', fontVariantNumeric: 'tabular-nums' }}>
            {pageFrom}–{pageTo} {t('lore.search.of', 'из')} {total}
          </span>
          <button type="button" disabled={!hasNext || loading}
            onClick={() => setOffset(offset + PAGE)}
            style={pagerStyle(!hasNext || loading)}>
            {t('lore.search.next', 'дальше')} →
          </button>
        </div>
      )}

      {/* Легенда и оговорки. Прототип зафиксировал три ограничения, и они не
          «баги на потом»: пользователь, не знающий о них, читает выдачу
          неверно — молчание здесь дороже места на экране. */}
      {result && hits.length > 0 && (
        <div style={{ marginTop: 4, padding: '8px 10px', borderTop: '1px solid var(--b1)',
                      fontSize: 11.5, color: 'var(--t3)', display: 'flex',
                      flexDirection: 'column', gap: 4 }}>
          <div>
            <b>{t('lore.search.legendRank', 'ранг')}</b> — {t('lore.search.legendRankText',
              'BM25 × приоритет типа. Приоритет задан нами, а не движком.')}
          </div>
          <div>
            <b>{t('lore.search.legendBar', 'полоса')}</b> — {t('lore.search.legendBarText',
              'ранг относительно первого места в этом же запросе.')}
          </div>
          <div>
            <b>{t('lore.search.legendWhere', 'где совпало')}</b> — {t('lore.search.legendWhereText',
              'считаем сами: ArcadeDB не сообщает, какое поле дало попадание.')}
          </div>
          <div style={{ marginTop: 2 }}>
            ⚠ {t('lore.search.caveatTitleBoost',
              'Заголовок не обгоняет тело: title_boost в ArcadeDB эффекта не дал.')}
          </div>
          <div>
            ⚠ {t('lore.search.caveatScores',
              'Скоры сравнимы только внутри одного запроса, между запросами — нет.')}
          </div>
          <div>
            ⚠ {t('lore.search.caveatProjects',
              'Проект проставлен не везде: есть у спринтов и PR, у спек и задач — нет. Фильтр по проекту скроет всё остальное.')}
          </div>
        </div>
      )}
    </div>
  );
}

const pagerStyle = (disabled: boolean) => ({
  fontSize: 12, padding: '4px 12px',
  cursor: disabled ? 'default' : 'pointer',
  border: '1px solid var(--b1)', borderRadius: 6,
  background: 'var(--s1)', color: disabled ? 'var(--t3)' : 'var(--t2)',
  opacity: disabled ? .5 : 1,
});
