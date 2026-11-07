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
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { KitConfig, KitCtx, KitData, KitFilter, KitRecord, KitVerdict } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { Pill } from '../elements/Pill';
import { kitT, useKitLang } from '../i18n';
import type { KitKey, KitLang } from '../i18n';
import { pushUrlState, readUrlState } from '../resilience/urlState';
import type { UrlWindow } from '../resilience/urlState';
import { EmptyState, LoadError } from '../states/StateViews';
import { ProgressCell } from './progress';
import {
  DEFAULT_LIST_STATE, LIST_BUDGET, applyFilters, boardColumns, fieldValue, groupRecords,
  quickCounts, readListState, shownOf, sortRecords, valueKey, writeListState,
} from './listModel';
import type { ListGroup, ListState, ListViewKind } from './listModel';

export interface ListBulkAction {
  id: string;
  title: string;
  /** Хук действия: получает id выбранных записей. Сохранение — забота приложения. */
  run: (ids: string[]) => void;
}

/**
 * Раскрытие строки (S4-09, составные объекты): под записью — её вложенное
 * содержимое (у спринта — задачи). Рисуется только у раскрытой строки, так что
 * приложение может грузить вложенное лениво, по раскрытию.
 */
export interface ListExpand {
  render: (r: KitRecord) => ReactNode;
  /** Можно ли раскрыть запись; по умолчанию — да. */
  can?: (r: KitRecord) => boolean;
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
  /** Раскрытие строки с вложенным содержимым (только вид «Список»). */
  expand?: ListExpand;
  className?: string;
}

const BUILTIN_KEY_TITLES: Record<string, KitKey> = {
  title: 'kit.list.col.title',
  id: 'kit.list.col.id',
  status: 'kit.list.col.status',
  kind: 'kit.list.col.kind',
  updated_at: 'kit.list.col.updated',
};
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

/** Раскрытые строки в URL: lx=id1,id2 (id кодирует URLSearchParams). */
const EXPAND_PARAM = 'lx';
function initialExpanded(win: UrlWindow | null): Set<string> {
  if (!win) return new Set();
  const raw = readUrlState(win).get(EXPAND_PARAM);
  return new Set(raw ? raw.split(',').filter(Boolean) : []);
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
    const fieldTitles = new Map<string, string>();
    for (const k of Object.values(config.kinds)) for (const f of k.fields ?? []) fieldTitles.set(f.key, f.title);
    const keyTitle = (key: string): string => {
      const builtin = BUILTIN_KEY_TITLES[key];
      if (builtin) return kitT(lang, builtin);
      const bare = key.startsWith('fields.') ? key.slice(7) : key;
      return fieldTitles.get(bare) ?? fieldTitles.get(key) ?? bare;
    };
    const valueTitle = (key: string, v: string): string => {
      if (key === 'status') {
        const s = statuses.get(v);
        return s ? s.title : kitT(lang, 'kit.list.unknownStatus', { code: v || '∅' });
      }
      if (v === '') return kitT(lang, 'kit.list.noValue');
      if (key === 'kind') return config.kinds[v]?.title ?? v;
      return v;
    };
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
  config, data, href, ctx: ctxPart, bulkActions, onSelectionChange, urlState, initial, budget: budgetPart, expand, className,
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
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(win));
  const toggleExpand = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    if (win) pushUrlState({ [EXPAND_PARAM]: n.size ? [...n].join(',') : null }, { win, replace: true });
    return n;
  });

  const listCfg = config.list;
  const views = (listCfg?.views ?? ['list']).filter(v => VIEWS_RENDERED.includes(v));
  const view: ListViewKind = views.includes(state.view) ? state.view : (views[0] ?? 'list');
  const quick = listCfg?.quick ?? [];
  const filterKeys = listCfg?.filters ?? [];
  const groupings = listCfg?.groupings ?? [];
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

  const groupBy = view === 'board' ? 'status' : state.group;
  const groups: ListGroup[] = view === 'board' ? boardColumns(filtered, config) : groupRecords(filtered, groupBy, config, budget);
  const collapsedByDefault = view === 'list' && groups.some(g => g.other);
  const cur = ui.by === groupBy && ui.view === view ? ui : { by: groupBy, view, open: {}, more: {} };
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

  const groupTitle = (g: ListGroup): string => {
    if (g.other) return t('kit.list.others', { groups: g.groupCount ?? 0 });
    return groupBy ? labels.valueTitle(groupBy, g.key) : '';
  };

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
    view === 'list' ? `${t('kit.list.desc.group')}: ${state.group ? labels.keyTitle(state.group) : t('kit.list.groupNone')}` : null,
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
      default:
        if (col.startsWith('progress:')) return <ProgressCell value={fieldValue(r, col.slice(9))} />;
        return valueKey(fieldValue(r, col)) || '—';
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
      default: return labels.keyTitle(col.startsWith('progress:') ? col.slice(9) : col);
    }
  };

  const moreButton = (g: ListGroup, limit: number) => {
    const rest = g.records.length - limit;
    return rest > 0
      ? <button type="button" className="sk-btn" onClick={() => showMore(g.key)}>{t('kit.list.more', { n: rest })}</button>
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
    body = (
      <div className="sk-board">
        {groups.map(g => {
          const limit = limitOf(g.key);
          const s = labels.statuses.get(g.key);
          const title = labels.valueTitle('status', g.key);
          return (
            <section
              key={g.key}
              className={`sk-board__col${g.unknown ? ' is-unknown' : ''}`}
              aria-label={t('kit.list.column', { title, n: g.records.length })}
              data-status={g.key}
              style={{ '--st-c': s?.color ?? 'var(--t3)' } as CSSProperties}
            >
              <h3 className="sk-board__head">
                <GameIcon slug={s?.icon ?? 'help'} size={14} />
                <span className="sk-board__title">{title}</span>
                <span className="sk-board__count">{g.records.length}</span>
              </h3>
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
              {moreButton(g, limit)}
            </section>
          );
        })}
      </div>
    );
  } else {
    const grouped = groupBy !== null;
    const span = columns.length + (expand ? 1 : 0);
    const xid = (id: string) => `sk-lx-${id.replace(/[^w-]/g, '_')}`;
    const expandCell = (r: KitRecord) => {
      if (!expand) return null;
      if (expand.can && !expand.can(r)) return <td className="sk-list__td sk-list__xcell" />;
      const open = expanded.has(r.id);
      return (
        <td className="sk-list__td sk-list__xcell">
          <button
            type="button"
            className="sk-list__xbtn"
            aria-expanded={open}
            aria-controls={open ? xid(r.id) : undefined}
            aria-label={t(open ? 'kit.list.collapse' : 'kit.list.expand', { title: r.title })}
            onClick={() => toggleExpand(r.id)}
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
        </td>
      );
    };
    const expandRow = (r: KitRecord) => {
      if (!expand || !expanded.has(r.id) || (expand.can && !expand.can(r))) return null;
      return (
        <tr className="sk-list__xrow" data-expand-of={r.id}>
          <td colSpan={span} id={xid(r.id)} className="sk-list__xbody">{expand.render(r)}</td>
        </tr>
      );
    };
    body = (
      <div className="sk-list__scroll">
        <table className="sk-list__table">
          <thead>
            <tr>{expand && <th scope="col" className="sk-list__th sk-list__xcell"><span className="sk-sr">{t('kit.list.col.expand')}</span></th>}{columns.map(c => <th key={c} scope="col" className={`sk-list__th sk-list__c-${c.replace(/[^a-z0-9]+/g, '-')}`}>{colTitle(c)}</th>)}</tr>
          </thead>
          {groups.map(g => {
            const open = !grouped || isOpen(g.key);
            const limit = limitOf(g.key);
            return (
              <tbody key={g.key}>
                {grouped && (
                  <tr className="sk-list__ghead" data-group-key={g.key} data-other={g.other ? 'true' : undefined}>
                    <th colSpan={span} scope="rowgroup">
                      <button type="button" className="sk-list__gbtn" aria-expanded={open} onClick={() => toggleGroup(g.key)}>
                        <span className="sk-list__chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                        <span className={g.unknown ? 'sk-list__gtitle is-unknown' : 'sk-list__gtitle'}>{groupTitle(g)}</span>
                        <span className="sk-list__gcount">{g.records.length}</span>
                      </button>
                    </th>
                  </tr>
                )}
                {open && g.records.slice(0, limit).map(r => (
                  <Fragment key={r.id}>
                    <tr className={`sk-list__row${selected.has(r.id) ? ' is-selected' : ''}`} data-record-id={r.id}>
                      {expandCell(r)}
                      {columns.map(c => <td key={c} className={`sk-list__td sk-list__c-${c.replace(/[^a-z0-9]+/g, '-')}`}>{cell(c, r)}</td>)}
                    </tr>
                    {expandRow(r)}
                  </Fragment>
                ))}
                {open && g.records.length > limit && (
                  <tr className="sk-list__morerow"><td colSpan={span}>{moreButton(g, limit)}</td></tr>
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
        {view === 'list' && groupings.length > 0 && (
          <label className="sk-list__field">
            <span className="sk-list__label">{t('kit.list.group')}</span>
            <select
              aria-label={t('kit.list.group')}
              className="sk-list__select"
              value={state.group ?? ''}
              onChange={e => update({ group: e.target.value || null })}
            >
              <option value="">{t('kit.list.groupNone')}</option>
              {groupings.map(g => <option key={g} value={g}>{labels.keyTitle(g)}</option>)}
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
