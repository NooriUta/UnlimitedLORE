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
  DEFAULT_LIST_STATE, LIST_BUDGET, applyFilters,
  quickCounts, quickIconOf, readListState, shownOf, sortKeysOf, sortRecords, valuesOf, writeListState,
} from './listModel';
import type { FilterOp, ListGroup, ListState, ListViewKind } from './listModel';
import { boardLanes, groupBy, groupingOptions, multiGroupCount, parseGroupKey } from './grouping';
import { fieldValueTitle, groupKeyTitle, groupTitle as groupTitleOf } from './groupLabel';
import { applyFilterSet, describeFieldFilter, facetOf, toFilterSet } from './filterModel';
import type { FieldFilter } from './filterModel';
import { FacetFilter, ValueIconMark } from './FacetFilter';
import type { ValueIcon } from './FacetFilter';

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
  /**
   * Свои иконки «Быстро» (id → слаг game-icons). Без них «Быстро» по одному
   * статусу берёт иконку статуса из словаря (S4-04), прочие — без иконки.
   */
  quickIcons?: Record<string, string>;
  /**
   * Иконка значения поля в фасетах и ячейках (S4-05). undefined — по умолчанию
   * (статус и вид — из конфига), null — без иконки. Подпись остаётся всегда.
   */
  valueIcon?: (key: string, value: string) => ValueIcon | null | undefined;
  className?: string;
}

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
  if (params.has('lo')) s.ops = parsed.ops;
  if (params.has('lt')) s.text = parsed.text;
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
  config, data, href, ctx: ctxPart, bulkActions, onSelectionChange, urlState, initial, budget: budgetPart, quickIcons, valueIcon, className,
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
  // S4-05: поля (есть / нет / пусто / не пусто) и текст — одним набором
  const filterSet = useMemo(() => toFilterSet(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(state.filters), JSON.stringify(state.ops), state.text]);
  const activeQuick = quick.find(q => q.id === state.quick) ?? null;
  const quickFilters: KitFilter[] = activeQuick ? [activeQuick.filter] : [];
  const pool = useMemo(() => applyFilterSet(records, filterSet), [records, filterSet]);
  const counts = useMemo(() => quickCounts(pool, quick, []), [pool, quick]);
  const filtered = useMemo(() => sortRecords(applyFilters(pool, quickFilters), state.sort, config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, config, JSON.stringify(quickFilters), state.sort]);
  const iconOf = (key: string, v: string): ValueIcon | null | undefined => {
    const own = valueIcon?.(key, v);
    if (own !== undefined) return own;
    if (key === 'status') {
      const s = labels.statuses.get(v);
      return s ? { icon: s.icon, color: s.color } : null;
    }
    if (key === 'kind') {
      const k = config.kinds[v];
      return k ? { icon: k.icon } : null;
    }
    return null;
  };
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

  const hasFilter = Object.keys(filterSet.fields).length > 0 || !!filterSet.text || activeQuick !== null;
  const opTitles = Object.fromEntries((['any', 'not', 'empty', 'nonempty'] as FilterOp[])
    .map(op => [op, t(`kit.list.op.${op}` as KitKey)])) as Record<FilterOp, string>;
  // Строка-описание (S4-04): каждое условие — свой снимаемый чип, а не сплошной
  // текст: «что сейчас отсеивает записи» видно и снимается по одному. Условие
  // поля — с оператором (есть / нет / пусто / не пусто) и текстом (S4-05).
  const chips: { id: string; text: string; remove: () => void }[] = [];
  for (const [k, fl] of Object.entries(filterSet.fields)) {
    chips.push({
      id: `f:${k}`,
      text: `${labels.keyTitle(k)}: ${describeFieldFilter(fl, opTitles, v => labels.valueTitle(k, v))}`,
      remove: () => {
        const filters = { ...state.filters };
        const ops = { ...state.ops };
        delete filters[k];
        delete ops[k];
        update({ filters, ops });
      },
    });
  }
  if (filterSet.text) {
    chips.push({ id: 't', text: `${t('kit.list.desc.text')}: «${filterSet.text}»`, remove: () => update({ text: '' }) });
  }
  if (activeQuick) {
    chips.push({ id: 'q', text: `${t('kit.list.quick')}: ${activeQuick.title}`, remove: () => update({ quick: null }) });
  }
  const resetFilters = () => update({ filters: {}, ops: {}, text: '', quick: null });
  const descTail = [
    view === 'list' || (view === 'board' && hasGroupings) ? `${t('kit.list.desc.group')}: ${groupKey ? labels.keyTitle(groupKey) : t('kit.list.groupNone')}` : null,
    `${t('kit.list.desc.sort')}: ${state.sort ? `${labels.keyTitle(state.sort.key)} ${state.sort.dir === 'desc' ? '↓' : '↑'}` : t('kit.list.sortNone')}`,
  ].filter(Boolean).join(' · ');
  const filterCount = Object.keys(filterSet.fields).length + (filterSet.text ? 1 : 0);
  const segCount = (n: number) => (n > 0
    ? <span className="sk-list__segcount" data-testid="kit-list-segcount" title={t('kit.list.segActive', { n })}>{n}</span>
    : null);
  const sortKeys = sortKeysOf(config);
  if (state.sort && !sortKeys.includes(state.sort.key)) sortKeys.push(state.sort.key);

  const statusOrder = new Map(config.statuses.items.map((s, i) => [s.code, i]));
  const statusCompare = (a: string, b: string) => (statusOrder.get(a) ?? Infinity) - (statusOrder.get(b) ?? Infinity) || a.localeCompare(b);
  const fieldFilterOf = (k: string): FieldFilter => ({ op: state.ops[k] ?? 'any', values: state.filters[k] ?? [] });
  const setFieldFilter = (k: string, f: FieldFilter) => {
    const filters = { ...state.filters };
    const ops = { ...state.ops };
    if (f.values.length) filters[k] = f.values; else delete filters[k];
    if (f.op !== 'any') ops[k] = f.op; else delete ops[k];
    update({ filters, ops });
  };
  const valueCell = (key: string, r: KitRecord): ReactNode => {
    const vs = valuesOf(r, key);
    if (!vs.length) return '—';
    return (
      <span className="sk-list__vals">
        {vs.map(v => (
          <span key={v} className="sk-list__val"><ValueIconMark icon={iconOf(key, v)} />{labels.valueTitle(key, v)}</span>
        ))}
      </span>
    );
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
      default: return valueCell(col, r);
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
        action={hasFilter ? <button type="button" className="sk-btn" onClick={resetFilters}>{t('kit.list.reset')}</button> : undefined}
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
            {quick.map(q => {
              const icon = quickIcons?.[q.id] ?? quickIconOf(q, config);
              return (
                <Pill
                  key={q.id}
                  variant="filter"
                  pressed={state.quick === q.id}
                  onToggle={on => update({ quick: on ? q.id : null })}
                >
                  {icon && <span className="sk-list__qicon" data-quick-icon={icon}><GameIcon slug={icon} size={14} /></span>}
                  <span>{q.title}</span> <span className="sk-list__qcount">{counts[q.id] ?? 0}</span>
                </Pill>
              );
            })}
          </div>
        )}
      </div>

      {/* Строка [Фильтр][Группировка][Порядок] (S4-04): три сегмента fieldset+legend —
          имя сегмента не спорит с подписью внутри. В сегменте фильтра — поиск по
          тексту и фасеты полей (S4-05). */}
      <div role="group" aria-label={t('kit.list.filters')} className="sk-list__controls" data-testid="kit-list-controls">
        <fieldset className="sk-list__seg" data-seg="filter">
          <legend className="sk-list__seglabel">{t('kit.list.desc.filter')}</legend>
          <GameIcon slug="funnel" size={14} className="sk-list__segicon" />
          {segCount(filterCount)}
          <input
            type="search"
            className="sk-list__search"
            aria-label={t('kit.list.text')}
            placeholder={t('kit.list.textPlaceholder')}
            value={state.text}
            onChange={e => update({ text: e.target.value })}
          />
          {filterKeys.map(k => (
            <FacetFilter
              key={k}
              title={labels.keyTitle(k)}
              filter={fieldFilterOf(k)}
              facet={facetOf(records, filterSet, k)}
              valueTitle={v => labels.valueTitle(k, v)}
              valueIcon={v => iconOf(k, v)}
              compare={k === 'status' ? statusCompare : undefined}
              onChange={fl => setFieldFilter(k, fl)}
              lang={lang}
            />
          ))}
        </fieldset>
        {(view === 'list' || view === 'board') && hasGroupings && (
          <fieldset className="sk-list__seg" data-seg="group">
          <legend className="sk-list__seglabel">{t('kit.list.group')}</legend>
          <GameIcon slug="stack" size={14} className="sk-list__segicon" />
          {segCount(groupKey ? 1 : 0)}
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
          </fieldset>
        )}
        <fieldset className="sk-list__seg" data-seg="sort">
          <legend className="sk-list__seglabel">{t('kit.list.sort')}</legend>
          <GameIcon slug="histogram" size={14} className="sk-list__segicon" />
          {segCount(state.sort ? 1 : 0)}
          <select
            aria-label={t('kit.list.sort')}
            className="sk-list__select"
            value={state.sort?.key ?? ''}
            onChange={e => update({ sort: e.target.value ? { key: e.target.value, dir: state.sort?.dir ?? 'asc' } : null })}
          >
            <option value="">{t('kit.list.sortNone')}</option>
            {sortKeys.map(k => <option key={k} value={k}>{labels.keyTitle(k)}</option>)}
          </select>
          <button
            type="button"
            className="sk-list__dir"
            aria-pressed={state.sort?.dir === 'desc'}
            disabled={!state.sort}
            onClick={() => state.sort && update({ sort: { ...state.sort, dir: state.sort.dir === 'desc' ? 'asc' : 'desc' } })}
          >
            {t('kit.list.sortDesc')}
          </button>
        </fieldset>
      </div>

      <div className="sk-list__desc" data-testid="kit-list-desc">
        <span className="sk-list__desclabel">{t('kit.list.desc.filter')}:</span>
        {chips.length === 0 && <span>{t('kit.list.filterNone')}</span>}
        {chips.map(c => (
          <Pill
            key={c.id}
            variant="filter"
            pressed
            onToggle={on => { if (!on) c.remove(); }}
            onRemove={c.remove}
            removeLabel={t('kit.list.removeChip', { what: c.text })}
          >
            {c.text}
          </Pill>
        ))}
        <span className="sk-list__desctail">· {descTail}</span>
        {hasFilter && (
          <button type="button" className="sk-btn" onClick={resetFilters}>{t('kit.list.reset')}</button>
        )}
      </div>
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
