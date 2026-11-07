// listView kit (SPRINT_UXR_S10_SEIDR_KIT/K-03, только чтение): Список/Доска,
// «Быстро»-счётчики как фильтр, строка «фильтр / группировка / порядок» с
// описанием, «Показано N из M» из meta (формат K-01), выделение и массовые
// действия через хук. Всё — из конфига (контракт kit/src/core/contract.ts),
// ничего не захардкожено под LORE.
//
// Бюджет строк — правила S9: не больше 50 на группу и «ещё N», при >20
// группах — топ-10 + «Прочие», и тогда все группы свёрнуты (S9-01, S9-02).
// Честность: статус вне словаря виден как «вне словаря», ошибка блока из
// meta.errors — errBlock с причиной, исключение вердикта — ошибка только в
// своей ячейке, проверенный ноль ≠ «фильтр всё отсеял».
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { KitConfig, KitCtx, KitData, KitFilter, KitRecord, KitVerdict } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { Pill } from '../elements/Pill';
import { kitT, useKitLang } from '../i18n';
import type { KitKey, KitLang } from '../i18n';
import { pushUrlState, readUrlState } from '../resilience/urlState';
import type { UrlWindow } from '../resilience/urlState';
import { EmptyState, LoadError } from '../states/StateViews';
import {
  DEFAULT_LIST_STATE, LIST_BUDGET, applyFilters, fieldValue,
  quickCounts, readListState, shownOf, sortRecords, valueKey, writeListState,
} from './listModel';
import { boardLanes, groupBy, groupingOptions, multiGroupCount, parseGroupKey } from './grouping';
import { fieldValueTitle, groupKeyTitle, groupTitle as groupTitleOf } from './groupLabel';
import type { ListGroup, ListState, ListViewKind } from './listModel';

export interface ListBulkAction {
  id: string;
  title: string;
  /** Хук действия: получает id выбранных записей. Сохранение — забота приложения. */
  run: (ids: string[]) => void;
}

export interface ListViewProps {
  config: KitConfig;
  data: KitData;
  /** Ссылка на запись (заголовок становится ссылкой). */
  href?: (id: string) => string;
  /** Части контекста хуков (роль, пользователь, md…); data/config берутся из пропсов. */
  ctx?: Partial<KitCtx>;
  /** Массовые действия с выбранными — через хуки приложения. */
  bulkActions?: ListBulkAction[];
  onSelectionChange?: (ids: string[]) => void;
  /** Состояние в URL: по умолчанию window, false — только в памяти, объект — свой (тесты, iframe). */
  urlState?: boolean | UrlWindow;
  /** Начальное состояние (URL важнее). */
  initial?: Partial<ListState>;
  budget?: Partial<typeof LIST_BUDGET>;
  className?: string;
}

const SORT_KEYS = ['title', 'id', 'status', 'updated_at'] as const;
const VIEWS_RENDERED: ListViewKind[] = ['list', 'board'];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function resolveWin(urlState: ListViewProps['urlState']): UrlWindow | null {
  if (urlState === false) return null;
  if (urlState && typeof urlState === 'object') return urlState;
  return typeof window === 'undefined' ? null : window;
}

function initialState(win: UrlWindow | null, initial: Partial<ListState> | undefined): ListState {
  const s: ListState = { ...DEFAULT_LIST_STATE, ...initial };
  if (!win) return s;
  const params = readUrlState(win);
  const parsed = readListState(params);
  if (params.has('lv')) s.view = parsed.view;
  if (params.has('lq')) s.quick = parsed.quick;
  if (params.has('lg')) s.group = parsed.group;
  if (params.has('ls')) s.sort = parsed.sort;
  if (params.has('lf')) s.filters = parsed.filters;
  return s;
}

/** Подписи ключей, значений и статусов — из конфига, общие для списка и доски. */
function useLabels(config: KitConfig, lang: KitLang) {
  return useMemo(() => {
    const statuses = new Map(config.statuses.items.map(s => [s.code, s]));
    // Подписи — общие с дорожками доски и таймлайна (groupLabel, S4-06).
    const keyTitle = (key: string): string => groupKeyTitle(config, lang, key);
    const valueTitle = (key: string, v: string): string => fieldValueTitle(config, lang, key, v);
    return { statuses, keyTitle, valueTitle };
  }, [config, lang]);
}

type Labels = ReturnType<typeof useLabels>;

function StatusCell({ code, labels }: { code: string; labels: Labels }) {
  const s = labels.statuses.get(code);
  const style = { '--st-c': s?.color ?? 'var(--t3)' } as CSSProperties;
  return (
    <span className={`sk-list__status${s ? '' : ' is-unknown'}`} style={style} data-status={code}>
      <GameIcon slug={s?.icon ?? 'help'} size={14} />
      <span>{labels.valueTitle('status', code)}</span>
    </span>
  );
}

function VerdictCell({ r, ctx, lang }: { r: KitRecord; ctx: KitCtx; lang: KitLang }) {
  const fn = ctx.config.verdict;
  if (!fn) return <span className="sk-list__verdict" data-verdict="none">—</span>;
  let v: KitVerdict;
  try {
    v = fn(r, ctx);
  } catch (e) {
    return (
      <span className="sk-list__verdict" data-verdict="error" title={e instanceof Error ? e.message : String(e)}>
        {kitT(lang, 'kit.list.verdictError')}
      </span>
    );
  }
  if (!v.max) return <span className="sk-list__verdict" data-verdict="none">—</span>;
  const state = v.failed.length ? 'fail' : 'ok';
  return (
    <span className="sk-list__verdict" data-verdict={state} title={[...v.failed, ...v.hints].join(', ') || undefined}>
      {v.score}/{v.max}
    </span>
  );
}

function Title({ r, href }: { r: KitRecord; href?: (id: string) => string }) {
  return href
    ? <a className="sk-list__title" href={href(r.id)}>{r.title}</a>
    : <span className="sk-list__title">{r.title}</span>;
}

export function ListView({
  config, data, href, ctx: ctxPart, bulkActions, onSelectionChange, urlState, initial, budget: budgetPart, className,
}: ListViewProps) {
  const lang = useKitLang();
  const t = (k: KitKey, vars?: Record<string, string | number>) => kitT(lang, k, vars);
  const labels = useLabels(config, lang);
  const budget = { ...LIST_BUDGET, ...budgetPart };
  const win = resolveWin(urlState);
  const [state, setState] = useState<ListState>(() => initialState(win, initial));
  const [ui, setUi] = useState<{ by: string | null; view: ListViewKind; open: Record<string, boolean>; more: Record<string, number> }>(
    { by: state.group, view: state.view, open: {}, more: {} },
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const listCfg = config.list;
  const views = (listCfg?.views ?? ['list']).filter(v => VIEWS_RENDERED.includes(v));
  const view: ListViewKind = views.includes(state.view) ? state.view : (views[0] ?? 'list');
  const quick = listCfg?.quick ?? [];
  const filterKeys = listCfg?.filters ?? [];
  const groupOpts = useMemo(() => groupingOptions(config), [config]);
  const hasGroupings = groupOpts.fields.length + groupOpts.relations.length > 0;
  const columns = listCfg?.columns ?? ['title+id', 'status'];

  const update = (patch: Partial<ListState>) => {
    setState(prev => {
      const next = { ...prev, ...patch };
      if (win) pushUrlState(writeListState(next), { win, replace: true });
      return next;
    });
  };

  const ctx: KitCtx = useMemo(() => ({
    data, config, href: href ?? (id => `#${encodeURIComponent(id)}`), esc, md: (s: string) => s, ...ctxPart,
  }), [data, config, href, ctxPart]);

  const records = data.records;
  const fieldFilters: KitFilter[] = Object.entries(state.filters)
    .filter(([, v]) => v.length > 0).map(([k, v]) => ({ [k]: v }));
  const activeQuick = quick.find(q => q.id === state.quick) ?? null;
  const allFilters = activeQuick ? [...fieldFilters, activeQuick.filter] : fieldFilters;
  const counts = useMemo(() => quickCounts(records, quick, fieldFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, quick, JSON.stringify(state.filters)]);
  const filtered = useMemo(() => sortRecords(applyFilters(records, allFilters), state.sort, config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, config, JSON.stringify(allFilters), state.sort]);
  const edgeCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.edges) {
      m.set(e.from, (m.get(e.from) ?? 0) + 1);
      if (e.to !== e.from) m.set(e.to, (m.get(e.to) ?? 0) + 1);
    }
    return m;
  }, [data.edges]);

  // Общая группировка (S4-06): один ключ lg — группы списка и дорожки доски.
  const groupKey = parseGroupKey(state.group).type === 'none' ? null : state.group;
  const lanes = view === 'board' ? boardLanes(filtered, groupKey, config, data, budget) : [];
  const laned = view === 'board' && groupKey !== null && groupKey !== 'status';
  const groups: ListGroup[] = view === 'board' ? lanes.map(l => l.lane) : groupBy(filtered, groupKey, config, data, budget);
  const multi = (view === 'list' || laned) && groupKey ? multiGroupCount(groups) : 0;
  const collapsedByDefault = (view === 'list' || laned) && groups.some(g => g.other);
  const cur = ui.by === groupKey && ui.view === view ? ui : { by: groupKey, view, open: {}, more: {} };
  const isOpen = (k: string) => cur.open[k] ?? !collapsedByDefault;
  const limitOf = (k: string) => cur.more[k] ?? budget.perGroup;
  const toggleGroup = (k: string) => setUi({ ...cur, open: { ...cur.open, [k]: !isOpen(k) } });
  const showMore = (k: string) => setUi({ ...cur, more: { ...cur.more, [k]: limitOf(k) + budget.perGroup } });

  useEffect(() => { onSelectionChange?.([...selected]); }, [selected, onSelectionChange]);
  const toggleSel = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allShownSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(filtered.map(r => r.id)));
  const selectable = columns.includes('select');

  const groupTitle = (g: ListGroup): string => groupTitleOf(config, lang, groupKey, g);

  const errors = (data.meta.errors ?? []).filter(e => e.block === 'records' || e.block === 'list');
  const shown = shownOf(data.meta, records.length, filtered.length);
  const shownText = shown.kind === 'complete'
    ? t('kit.list.shown', { shown: shown.shown, total: shown.total })
    : shown.kind === 'truncated'
      ? t('kit.list.shownTruncated', { shown: shown.shown, total: shown.total, loaded: shown.loaded })
      : t('kit.list.shownUnknown', { shown: shown.shown, loaded: shown.loaded });

  const hasFilter = fieldFilters.length > 0 || activeQuick !== null;
  const descParts: string[] = [];
  for (const [k, vs] of Object.entries(state.filters)) {
    if (vs.length) descParts.push(`${labels.keyTitle(k)}: ${vs.map(v => labels.valueTitle(k, v)).join(' | ')}`);
  }
  if (activeQuick) descParts.push(`${t('kit.list.quick')}: ${activeQuick.title}`);
  const desc = [
    `${t('kit.list.desc.filter')}: ${descParts.length ? descParts.join(' · ') : t('kit.list.filterNone')}`,
    view === 'list' || (view === 'board' && hasGroupings) ? `${t('kit.list.desc.group')}: ${groupKey ? labels.keyTitle(groupKey) : t('kit.list.groupNone')}` : null,
    `${t('kit.list.desc.sort')}: ${state.sort ? `${labels.keyTitle(state.sort.key)} ${state.sort.dir === 'desc' ? '↓' : '↑'}` : t('kit.list.sortNone')}`,
  ].filter(Boolean).join(' · ');

  const filterOptions = (key: string) => {
    const m = new Map<string, number>();
    for (const r of records) {
      const v = valueKey(fieldValue(r, key));
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    const order = new Map(config.statuses.items.map((s, i) => [s.code, i]));
    return [...m].sort((a, b) => key === 'status'
      ? (order.get(a[0]) ?? Infinity) - (order.get(b[0]) ?? Infinity)
      : b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  const checkbox = (r: KitRecord) => (
    <label className="sk-list__check">
      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} aria-label={t('kit.list.select', { title: r.title })} />
    </label>
  );

  const cell = (col: string, r: KitRecord): ReactNode => {
    switch (col) {
      case 'select': return checkbox(r);
      case 'title+id': return <><Title r={r} href={href} /> <Pill variant="id">{r.id}</Pill></>;
      case 'title': return <Title r={r} href={href} />;
      case 'id': return <Pill variant="id">{r.id}</Pill>;
      case 'status': return <StatusCell code={r.status} labels={labels} />;
      case 'kind': return labels.valueTitle('kind', r.kind);
      case 'verdict': return <VerdictCell r={r} ctx={ctx} lang={lang} />;
      case 'updated_at': return r.updated_at ? <span className="sk-list__mono">{r.updated_at.slice(0, 10)}</span> : '—';
      case 'edges_count': return <span className="sk-list__mono">{edgeCount.get(r.id) ?? 0}</span>;
      default: return valueKey(fieldValue(r, col)) || '—';
    }
  };
  const colTitle = (col: string): ReactNode => {
    switch (col) {
      case 'select': return (
        <label className="sk-list__check">
          <input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label={t('kit.list.selectAll', { n: filtered.length })} />
        </label>
      );
      case 'title+id': return t('kit.list.col.title');
      case 'verdict': return t('kit.list.col.verdict');
      case 'edges_count': return t('kit.list.col.edges');
      default: return labels.keyTitle(col);
    }
  };

  const moreButton = (g: ListGroup, limit: number, key: string = g.key) => {
    const rest = g.records.length - limit;
    return rest > 0
      ? <button type="button" className="sk-btn" onClick={() => showMore(key)}>{t('kit.list.more', { n: rest })}</button>
      : null;
  };

  let body: ReactNode;
  if (records.length === 0 && shown.kind === 'complete') {
    body = <EmptyState />;
  } else if (filtered.length === 0 && records.length > 0) {
    body = (
      <EmptyState
        title={t('kit.list.emptyFiltered')}
        hint={t('kit.list.emptyFilteredHint')}
        action={hasFilter ? <button type="button" className="sk-btn" onClick={() => update({ filters: {}, quick: null })}>{t('kit.list.reset')}</button> : undefined}
      />
    );
  } else if (view === 'board') {
    // В дорожке имя колонки несёт имя дорожки — иначе «готово: 1» в каждой
    // дорожке даёт одинаковые landmark-и (axe landmark-unique).
    const columnsOf = (cols: ListGroup[], lane: ListGroup | null, heading: 'h3' | 'h4') => (
      <div className="sk-board">
        {cols.map(g => {
          const mk = lane === null ? g.key : `${lane.key}\u0001${g.key}`;
          const limit = limitOf(mk);
          const Head = heading;
          const s = labels.statuses.get(g.key);
          const title = labels.valueTitle('status', g.key);
          const name = lane === null ? title : `${groupTitle(lane)} · ${title}`;
          return (
            <section
              key={g.key}
              className={`sk-board__col${g.unknown ? ' is-unknown' : ''}`}
              aria-label={t('kit.list.column', { title: name, n: g.records.length })}
              data-status={g.key}
              style={{ '--st-c': s?.color ?? 'var(--t3)' } as CSSProperties}
            >
              <Head className="sk-board__head">
                <GameIcon slug={s?.icon ?? 'help'} size={14} />
                <span className="sk-board__title">{title}</span>
                <span className="sk-board__count">{g.records.length}</span>
              </Head>
              <ul className="sk-board__cards">
                {g.records.slice(0, limit).map(r => (
                  <li key={r.id} className={`sk-board__card${selected.has(r.id) ? ' is-selected' : ''}`} data-record-id={r.id}>
                    {selectable && checkbox(r)}
                    <span className="sk-board__body">
                      <Title r={r} href={href} />
                      <Pill variant="id">{r.id}</Pill>
                      {columns.includes('verdict') && <VerdictCell r={r} ctx={ctx} lang={lang} />}
                    </span>
                  </li>
                ))}
              </ul>
              {moreButton(g, limit, mk)}
            </section>
          );
        })}
      </div>
    );
    body = laned
      ? (
        <div className="sk-board__lanes">
          {lanes.map(({ lane, columns: cols }) => {
            const open = isOpen(lane.key);
            const title = groupTitle(lane);
            return (
              <section
                key={lane.key}
                className="sk-board__lane"
                data-lane-key={lane.key}
                data-other={lane.other ? 'true' : undefined}
                aria-label={t('kit.list.lane', { title, n: lane.records.length })}
              >
                <h3 className="sk-board__lanehead">
                  <button type="button" className="sk-list__gbtn" aria-expanded={open} onClick={() => toggleGroup(lane.key)}>
                    <span className="sk-list__chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                    <span className={lane.missing || lane.none ? 'sk-list__gtitle is-unknown' : 'sk-list__gtitle'}>{title}</span>
                    <span className="sk-list__gcount">{lane.records.length}</span>
                  </button>
                </h3>
                {open && columnsOf(cols, lane, 'h4')}
              </section>
            );
          })}
        </div>
      )
      : columnsOf(lanes[0]?.columns ?? [], null, 'h3');
  } else {
    const grouped = groupKey !== null;
    body = (
      <div className="sk-list__scroll">
        <table className="sk-list__table">
          <thead>
            <tr>{columns.map(c => <th key={c} scope="col" className={`sk-list__th sk-list__c-${c.replace(/[^a-z0-9]+/g, '-')}`}>{colTitle(c)}</th>)}</tr>
          </thead>
          {groups.map(g => {
            const open = !grouped || isOpen(g.key);
            const limit = limitOf(g.key);
            return (
              <tbody key={g.key}>
                {grouped && (
                  <tr className="sk-list__ghead" data-group-key={g.key} data-other={g.other ? 'true' : undefined}>
                    <th colSpan={columns.length} scope="rowgroup">
                      <button type="button" className="sk-list__gbtn" aria-expanded={open} onClick={() => toggleGroup(g.key)}>
                        <span className="sk-list__chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                        <span className={g.unknown || g.missing || g.none ? 'sk-list__gtitle is-unknown' : 'sk-list__gtitle'}>{groupTitle(g)}</span>
                        <span className="sk-list__gcount">{g.records.length}</span>
                      </button>
                    </th>
                  </tr>
                )}
                {open && g.records.slice(0, limit).map(r => (
                  <tr key={r.id} className={`sk-list__row${selected.has(r.id) ? ' is-selected' : ''}`} data-record-id={r.id}>
                    {columns.map(c => <td key={c} className={`sk-list__td sk-list__c-${c.replace(/[^a-z0-9]+/g, '-')}`}>{cell(c, r)}</td>)}
                  </tr>
                ))}
                {open && g.records.length > limit && (
                  <tr className="sk-list__morerow"><td colSpan={columns.length}>{moreButton(g, limit)}</td></tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    );
  }

  return (
    <div className={['sk-list', className].filter(Boolean).join(' ')} data-view={view}>
      {errors.map(e => (
        <LoadError key={e.block} compact title={t('kit.list.blockError', { block: e.block })} hint={e.reason} />
      ))}

      <div className="sk-list__bar">
        {views.length > 1 && (
          <div role="radiogroup" aria-label={t('kit.list.views')} className="sk-list__views">
            {views.map(v => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                className={`sk-list__view${view === v ? ' is-on' : ''}`}
                onClick={() => update({ view: v })}
              >
                {t(`kit.list.view.${v}` as KitKey)}
              </button>
            ))}
          </div>
        )}
        {quick.length > 0 && (
          <div role="group" aria-label={t('kit.list.quick')} className="sk-list__quick">
            <span className="sk-list__label" aria-hidden="true">{t('kit.list.quick')}</span>
            {quick.map(q => (
              <Pill
                key={q.id}
                variant="filter"
                pressed={state.quick === q.id}
                onToggle={on => update({ quick: on ? q.id : null })}
              >
                <span>{q.title}</span> <span className="sk-list__qcount">{counts[q.id] ?? 0}</span>
              </Pill>
            ))}
          </div>
        )}
      </div>

      <div role="group" aria-label={t('kit.list.filters')} className="sk-list__controls">
        {filterKeys.map(k => {
          const value = state.filters[k]?.[0];
          return (
            <label key={k} className="sk-list__field">
              <span className="sk-list__label">{labels.keyTitle(k)}</span>
              <select
                aria-label={labels.keyTitle(k)}
                className="sk-list__select"
                value={value ?? '\u0000all'}
                onChange={e => {
                  const v = e.target.value;
                  const next = { ...state.filters };
                  if (v === '\u0000all') delete next[k]; else next[k] = [v];
                  update({ filters: next });
                }}
              >
                <option value={'\u0000all'}>{t('kit.list.filterAll')}</option>
                {filterOptions(k).map(([v, n]) => <option key={v} value={v}>{`${labels.valueTitle(k, v)} · ${n}`}</option>)}
              </select>
            </label>
          );
        })}
        {(view === 'list' || view === 'board') && hasGroupings && (
          <label className="sk-list__field">
            <span className="sk-list__label">{t('kit.list.group')}</span>
            <select
              aria-label={t('kit.list.group')}
              className="sk-list__select"
              value={groupKey ?? ''}
              onChange={e => update({ group: e.target.value || null })}
            >
              <option value="">{t('kit.list.groupNone')}</option>
              {groupOpts.relations.length === 0
                ? groupOpts.fields.map(g => <option key={g} value={g}>{labels.keyTitle(g)}</option>)
                : (
                  <>
                    {groupOpts.fields.length > 0 && (
                      <optgroup label={t('kit.list.groupFields')}>
                        {groupOpts.fields.map(g => <option key={g} value={g}>{labels.keyTitle(g)}</option>)}
                      </optgroup>
                    )}
                    <optgroup label={t('kit.list.groupRels')}>
                      {groupOpts.relations.map(p => <option key={p.key} value={p.key}>{labels.keyTitle(p.key)}</option>)}
                    </optgroup>
                  </>
                )}
            </select>
          </label>
        )}
        <label className="sk-list__field">
          <span className="sk-list__label">{t('kit.list.sort')}</span>
          <select
            aria-label={t('kit.list.sort')}
            className="sk-list__select"
            value={state.sort?.key ?? ''}
            onChange={e => update({ sort: e.target.value ? { key: e.target.value, dir: state.sort?.dir ?? 'asc' } : null })}
          >
            <option value="">{t('kit.list.sortNone')}</option>
            {SORT_KEYS.map(k => <option key={k} value={k}>{labels.keyTitle(k)}</option>)}
          </select>
        </label>
        <button
          type="button"
          className="sk-list__dir"
          aria-pressed={state.sort?.dir === 'desc'}
          disabled={!state.sort}
          onClick={() => state.sort && update({ sort: { ...state.sort, dir: state.sort.dir === 'desc' ? 'asc' : 'desc' } })}
        >
          {t('kit.list.sortDesc')}
        </button>
      </div>

      <p className="sk-list__desc" data-testid="kit-list-desc">
        <span>{desc}</span>
        {hasFilter && (
          <button type="button" className="sk-btn" onClick={() => update({ filters: {}, quick: null })}>{t('kit.list.reset')}</button>
        )}
      </p>
      <p className="sk-list__shown" data-testid="kit-list-shown" data-kind={shown.kind} role="status">{shownText}</p>
      {multi > 0 && <p className="sk-list__multi" data-testid="kit-list-multi">{t('kit.list.multi', { n: multi })}</p>}

      {selected.size > 0 && (
        <div className="sk-list__selbar" data-testid="kit-list-selbar" role="group" aria-label={t('kit.list.bulk')}>
          <span>{t('kit.list.selected', { n: selected.size })}</span>
          {bulkActions?.map(a => (
            <button key={a.id} type="button" className="sk-btn" onClick={() => a.run([...selected])}>{a.title}</button>
          ))}
          <button type="button" className="sk-btn" onClick={() => setSelected(new Set())}>{t('kit.list.clearSelection')}</button>
        </div>
      )}

      {body}
    </div>
  );
}
