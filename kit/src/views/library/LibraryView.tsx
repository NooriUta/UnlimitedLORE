// Вид «Библиотека» — документы владельца по виду (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-LIBRARY).
//
// Прототип утверждён владелицей 11.11.2026: на десктопе группы слева, чтение
// на месте справа; на телефоне — список, документ открывается нижним листом.
// В группе первые пять, дальше «ещё N» (общая механика S9-11); если сервер
// прислал не всё — «показаны N из M», а не кнопка, которой нечего показать.
// Пусто, нет прав и сбой называются разными словами (честные состояния).
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { kitT, useKitLang } from '../../i18n';
import type { KitKey } from '../../i18n';
import { useNarrow } from '../../core/narrow';
import { useStepLimits } from '../../core/stepLimit';
import { MartProse } from '../../content/MartProse';
import { EmptyState, Forbidden, LoadError, Skeleton } from '../../states';
import { Sheet } from '../../shell/Sheet';
import { libraryModel } from './libraryModel';
import type { LibraryDoc, LibraryFilter, LibraryGroup } from './libraryModel';

export type LibraryStatus =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'forbidden'; reason?: string }
  | { kind: 'error'; error?: unknown; onRetry?: () => void };

export interface LibraryViewProps {
  groups: readonly LibraryGroup[];
  /** Состояние загрузки; нет — данные готовы. */
  status?: LibraryStatus;
  /** Выбранный документ (управляемый, если задан onSelect). */
  selected?: string;
  onSelect?: (id: string) => void;
  /** Поиск (управляемый, если задан onQuery) — чтобы приложение держало его в адресе. */
  query?: string;
  onQuery?: (query: string) => void;
  /** Фильтр «все / актуальные / устарели» (управляемый, если задан onFilter). */
  filter?: LibraryFilter;
  onFilter?: (filter: LibraryFilter) => void;
  /** Ссылка «Открыть паспорт». */
  href?: (id: string) => string;
  /**
   * Своя читалка справа (по умолчанию да). false — только дерево (K2-LIBRARY-DUP-PASSPORT, решение
   * владелицы 14.11): выбор уходит в onSelect, приложение открывает обычный паспорт своим
   * механизмом; своей читалки, нижнего листа и автовыбора первого документа нет.
   */
  reader?: boolean;
  /** Своё тело читалки; нет — MartProse по `doc.body`. */
  renderBody?: (doc: LibraryDoc) => ReactNode;
  /** Сколько документов видно в группе. По умолчанию 5 (прототип). */
  perGroup?: number;
  narrow?: boolean;
  className?: string;
}

export function LibraryView({ groups, status, selected: selectedProp, onSelect, query: queryProp, onQuery, filter: filterProp, onFilter, href, renderBody, reader: withReader = true, perGroup = 5, narrow: narrowProp, className }: LibraryViewProps) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const narrow = useNarrow(narrowProp);
  const [ownQuery, setOwnQuery] = useState('');
  const [ownFilter, setOwnFilter] = useState<LibraryFilter>('all');
  const query = queryProp ?? ownQuery;
  const filter = filterProp ?? ownFilter;
  const setQuery = (q: string) => { if (queryProp === undefined) setOwnQuery(q); onQuery?.(q); };
  const setFilter = (f: LibraryFilter) => { if (filterProp === undefined) setOwnFilter(f); onFilter?.(f); };
  const [own, setOwn] = useState<string | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const limits = useStepLimits(perGroup);
  const model = useMemo(() => libraryModel(groups, { query, filter }), [groups, query, filter]);

  const visible = model.groups.flatMap(g => g.docs);
  const selectedId = selectedProp ?? own ?? (narrow || !withReader ? undefined : visible[0]?.id);
  const current = visible.find(d => d.id === selectedId) ?? groups.flatMap(g => g.docs).find(d => d.id === selectedId);

  const pick = (id: string) => {
    if (selectedProp === undefined) setOwn(id);
    onSelect?.(id);
    if (narrow && withReader) setSheetOpen(true);
  };

  const cls = ['sk-lib', narrow ? 'sk-lib--narrow' : '', withReader ? '' : 'sk-lib--tree', className].filter(Boolean).join(' ');
  const kind = status?.kind ?? 'ready';
  if (kind === 'loading') return <div className={cls}><Skeleton lines={6} /></div>;
  if (status?.kind === 'forbidden') return <div className={cls}><Forbidden reason={status.reason} /></div>;
  if (status?.kind === 'error') return <div className={cls}><LoadError error={status.error} onRetry={status.onRetry} /></div>;
  if (groups.every(g => g.docs.length === 0)) return <div className={cls}><EmptyState title={t('kit.library.empty')} /></div>;

  const reader = (doc: LibraryDoc, withHead: boolean) => (
    <>
      {!renderBody && doc.meta && <div className="sk-lib__meta">{doc.meta}</div>}
      {withHead && !renderBody && <h3 className="sk-lib__title">{doc.title}</h3>}
      <div className="sk-lib__body">{renderBody ? renderBody(doc) : doc.body ? <MartProse text={doc.body} /> : null}</div>
      {href && !renderBody && <a className="sk-btn sk-lib__open" href={href(doc.id)}>{t('kit.library.open')}</a>}
    </>
  );

  const chips: { value: LibraryFilter; label: string }[] = [
    { value: 'all', label: t('kit.library.all') },
    { value: 'fresh', label: t('kit.library.fresh') },
    { value: 'stale', label: t('kit.library.stale', { n: model.staleCount }) },
  ];

  const side = (
    <div className="sk-lib__side">
      <input type="search" className="sk-lib__search" value={query} onChange={e => setQuery(e.target.value)}
        placeholder={t('kit.library.search')} aria-label={t('kit.library.search')} />
      <div className="sk-lib__chips" role="group" aria-label={t('kit.library.filter')}>
        {chips.map(c => (
          <button key={c.value} type="button" className="sk-pill sk-pill--filter" aria-pressed={filter === c.value}
            onClick={() => setFilter(c.value)}>{c.label}</button>
        ))}
      </div>
      {model.groups.length === 0 && <p className="sk-lib__none">{query.trim() ? t('kit.library.noMatch', { q: query.trim() }) : t('kit.library.noneInFilter')}</p>}
      {model.groups.map(g => {
        const limit = limits.limitOf(g.key);
        const shown = g.docs.slice(0, limit);
        const hidden = g.docs.length - shown.length;
        const total = g.total ?? g.docs.length;
        return (
          <section key={g.key} className="sk-lib__grp" aria-label={g.title}>
            <h4 className="sk-lib__gh">{g.title} <span className="sk-lib__gn">{total}</span></h4>
            <ul className="sk-lib__docs">
              {shown.map(d => (
                <li key={d.id}>
                  <button type="button" className="sk-lib__doc" data-doc-id={d.id} data-stale={d.stale ? '' : undefined}
                    aria-current={d.id === selectedId ? 'true' : undefined} onClick={() => pick(d.id)}>
                    {d.code && <span className="sk-lib__code">{d.code}</span>}
                    <span className="sk-lib__dt">{d.title}</span>
                    {d.state && <span className="sk-lib__st">{d.state}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {hidden > 0
              ? <button type="button" className="sk-lib__more" onClick={() => limits.showMore(g.key)}>{t('kit.library.more', { n: hidden })}</button>
              : total > g.docs.length && <span className="sk-lib__trunc">{t('kit.library.truncated', { n: g.docs.length, total })}</span>}
          </section>
        );
      })}
    </div>
  );

  if (!withReader) return <div className={cls}>{side}</div>;

  if (narrow) {
    return (
      <div className={cls}>
        {side}
        {current && (
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={current.title} side="bottom" className="sk-lib__sheet">
            {reader(current, false)}
          </Sheet>
        )}
      </div>
    );
  }

  return (
    <div className={cls}>
      {side}
      {current
        ? <article className="sk-lib__reader" aria-label={current.title}>{reader(current, true)}</article>
        : <div className="sk-lib__reader"><p className="sk-lib__none">{t('kit.library.pick')}</p></div>}
    </div>
  );
}
