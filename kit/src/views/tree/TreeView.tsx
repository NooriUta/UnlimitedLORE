// Вид «Дерево / книга» (SPRINT_UXR_S10_SEIDR_KIT/K-09) — третий вид в
// list.views рядом со «Список» и «Доска». Порядок — из данных (list.tree.order),
// уровни сворачиваются, у каждого уровня «N из M» под фильтром, свёртка
// вердикта/статуса поднимается к предкам, фильтр показывает совпадения вместе с
// цепочкой предков.
//
// ARIA: плоский role=tree с aria-level/posinset/setsize, роуминг-фокус
// (один tabIndex=0), стрелки ↑↓←→, Home/End, Enter — открыть запись.
// Честные состояния: «не настроен» ≠ «пусто» ≠ «под фильтр ничего не попало»;
// обрезанная выдача — явная плашка; сбой вердикта гасит только свою строку.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../../core/contract';
import { GameIcon } from '../../elements/GameIcon';
import { IconButton } from '../../elements/IconButton';
import { Pill } from '../../elements/Pill';
import { StatusStar } from '../../elements/StatusStar';
import { kitT, useKitLang } from '../../i18n';
import { pushUrlState, readUrlState } from '../../resilience/urlState';
import { EmptyState } from '../../states/StateViews';
import {
  buildTree, expandToLevel, filterWithAncestors, rollupStatus, rollupVerdict, visibleRows,
} from './treeModel';
import type { TreeRow } from './treeModel';

export interface TreeViewProps {
  data: KitData;
  config: KitConfig;
  /** Ссылка на запись (ctx.href). Без неё название — текст или кнопка onOpen. */
  href?: (id: string) => string;
  /** Открыть запись (клик по названию, Enter на строке). */
  onOpen?: (id: string) => void;
  /** Уровень раскрытия по умолчанию (1 — раскрыты корни). */
  defaultLevel?: number;
  /** Держать фильтр и уровень в URL (параметры tq, tlvl; фолбэк «#»). */
  urlSync?: boolean;
  className?: string;
}

/** Вид «Дерево» доступен, только если он объявлен в list.views и описан list.tree. */
export function treeViewEnabled(config: KitConfig): boolean {
  return !!config.list?.tree && (config.list.views ?? []).includes('tree');
}

/** Текст записи для фильтра: название, id, статус и простые поля. */
function haystack(r: KitRecord): string {
  const parts: string[] = [r.title, r.id, r.status];
  for (const v of Object.values(r.fields ?? {})) {
    if (typeof v === 'string' || typeof v === 'number') parts.push(String(v));
    else if (Array.isArray(v)) parts.push(v.filter(x => typeof x === 'string').join(' '));
  }
  return parts.join(' ').toLowerCase();
}

/** Строка дерева по id — без CSS.escape (его нет в jsdom и старых WebView). */
function rowEl(list: HTMLElement, id: string): HTMLElement | undefined {
  for (const el of Array.from(list.children)) if ((el as HTMLElement).dataset.id === id) return el as HTMLElement;
  return undefined;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function TreeView(props: TreeViewProps) {
  const { config } = props;
  const lang = useKitLang();
  if (!treeViewEnabled(config)) {
    return (
      <div className={['sk-tree', props.className].filter(Boolean).join(' ')} data-view="tree">
        <div className="sk-state sk-state--error" data-state="misconfigured" role="alert">
          <GameIcon slug="help" size={24} className="sk-state__icon" />
          <p className="sk-state__title">{kitT(lang, 'kit.tree.notConfigured')}</p>
          <p className="sk-state__hint">{kitT(lang, 'kit.tree.notConfiguredHint')}</p>
        </div>
      </div>
    );
  }
  return <TreeBody {...props} />;
}

function TreeBody({ data, config, href, onOpen, defaultLevel = 1, urlSync, className }: TreeViewProps) {
  const lang = useKitLang();
  const spec = config.list!.tree!;
  const model = useMemo(() => buildTree(data.records, spec), [data.records, spec]);

  const initial = useMemo(() => (urlSync && typeof window !== 'undefined' ? readUrlState() : new URLSearchParams()), [urlSync]);
  const [query, setQuery] = useState(() => initial.get('tq') ?? '');
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const lvl = initial.get('tlvl');
    const n = lvl === 'all' ? Infinity : lvl ? Number(lvl) : defaultLevel;
    return expandToLevel(model, Number.isFinite(n) || n === Infinity ? n : defaultLevel);
  });
  const [focusId, setFocusId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const setLevel = useCallback((n: number) => {
    setExpanded(expandToLevel(model, n));
    if (urlSync) pushUrlState({ tlvl: n === Infinity ? 'all' : String(n) });
  }, [model, urlSync]);

  const onQuery = (q: string) => {
    setQuery(q);
    if (urlSync) pushUrlState({ tq: q || null });
  };

  const filter = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    return filterWithAncestors(model, r => haystack(r).includes(q));
  }, [model, query]);

  const rows = useMemo(() => visibleRows(model, expanded, filter), [model, expanded, filter]);

  const statusItem = useMemo(() => new Map(config.statuses.items.map(s => [s.code, s])), [config.statuses.items]);
  const ctx = useMemo<KitCtx>(() => ({
    data, config, href: href ?? (id => `#rec=${encodeURIComponent(id)}`), esc, md: s => s,
  }), [data, config, href]);

  const statusRoll = useMemo(
    () => (spec.rollup === 'status' ? rollupStatus(model, s => statusItem.get(s)?.category ?? 'todo') : null),
    [model, spec.rollup, statusItem],
  );
  const verdictRoll = useMemo(
    () => (spec.rollup === 'verdict' && config.verdict ? rollupVerdict(model, r => config.verdict!(r, ctx)) : null),
    [model, spec.rollup, config.verdict, ctx],
  );

  const toggle = useCallback((id: string, open?: boolean) => {
    setExpanded(prev => {
      const next = new Set(prev);
      const want = open ?? !next.has(id);
      if (want) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const activeId = rows.some(r => r.node.id === focusId) ? focusId : rows[0]?.node.id ?? null;

  useEffect(() => {
    if (!focusId || !listRef.current) return;
    const el = rowEl(listRef.current, focusId);
    if (el && listRef.current.contains(document.activeElement) && document.activeElement !== el) el.focus();
  }, [focusId, rows]);

  const moveFocus = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    if (listRef.current) rowEl(listRef.current, id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement;
    if (target.getAttribute('role') !== 'treeitem') return; // кнопки и ссылки внутри строки — свои клавиши
    const idx = rows.findIndex(r => r.node.id === target.getAttribute('data-id'));
    if (idx < 0) return;
    const row = rows[idx];
    const hasKids = row.childShown > 0;
    switch (e.key) {
      case 'ArrowDown': moveFocus(rows[idx + 1]?.node.id); break;
      case 'ArrowUp': moveFocus(rows[idx - 1]?.node.id); break;
      case 'Home': moveFocus(rows[0]?.node.id); break;
      case 'End': moveFocus(rows[rows.length - 1]?.node.id); break;
      case 'ArrowRight':
        if (hasKids && !row.expanded && !filter) toggle(row.node.id, true);
        else if (row.expanded) moveFocus(rows[idx + 1]?.node.id);
        break;
      case 'ArrowLeft':
        if (row.expanded && !filter) toggle(row.node.id, false);
        else if (row.node.parentId) moveFocus(row.node.parentId);
        break;
      case 'Enter': onOpen?.(row.node.id); break;
      default: return;
    }
    e.preventDefault();
  };

  const levels = Array.from({ length: Math.max(1, model.maxDepth) }, (_, i) => i + 1);
  const total = model.byId.size;
  const metaTotal = data.meta?.total;

  return (
    <section className={['sk-tree', className].filter(Boolean).join(' ')} data-view="tree" aria-label={kitT(lang, 'kit.tree.label')}>
      <div className="sk-tree__bar" role="toolbar" aria-label={kitT(lang, 'kit.tree.toolbar')}>
        <span className="sk-tree__search">
          <GameIcon slug="magnifying-glass" size={14} />
          <input
            type="search"
            className="sk-tree__filter"
            aria-label={kitT(lang, 'kit.tree.filter')}
            placeholder={kitT(lang, 'kit.tree.filterPlaceholder')}
            value={query}
            onChange={e => onQuery(e.target.value)}
          />
        </span>
        <span className="sk-tree__levels" role="group" aria-label={kitT(lang, 'kit.tree.levels')}>
          {levels.map(n => (
            <button key={n} type="button" className="sk-tree__lvl" disabled={!!filter}
              aria-label={kitT(lang, 'kit.tree.level', { n })} title={kitT(lang, 'kit.tree.level', { n })}
              onClick={() => setLevel(n)}>{n}</button>
          ))}
          <button type="button" className="sk-tree__lvl" disabled={!!filter}
            aria-label={kitT(lang, 'kit.tree.levelAll')} title={kitT(lang, 'kit.tree.levelAll')}
            onClick={() => setLevel(Infinity)}>{kitT(lang, 'kit.tree.levelAllShort')}</button>
        </span>
        <span className="sk-tree__summary" aria-live="polite">
          {filter
            ? kitT(lang, 'kit.tree.summaryFiltered', { matched: filter.matched.size, total, visible: filter.visible.size })
            : kitT(lang, 'kit.tree.summary', { total })}
        </span>
      </div>

      {data.meta?.truncated && (
        <p className="sk-tree__trunc" role="status">
          {kitT(lang, 'kit.tree.truncated', { shown: total, total: metaTotal ?? '?' })}
        </p>
      )}

      {total === 0 ? (
        <EmptyState />
      ) : filter && rows.length === 0 ? (
        <EmptyState
          title={kitT(lang, 'kit.tree.noMatch')}
          hint={kitT(lang, 'kit.tree.noMatchHint', { total })}
          action={<button type="button" className="sk-btn" onClick={() => onQuery('')}>{kitT(lang, 'kit.tree.filterReset')}</button>}
        />
      ) : (
        <ul ref={listRef} className="sk-tree__list" role="tree" aria-label={kitT(lang, 'kit.tree.label')} onKeyDown={onKeyDown}>
          {rows.map(row => (
            <TreeItem
              key={row.node.id}
              row={row}
              config={config}
              filtered={!!filter}
              tabbable={row.node.id === activeId}
              href={href}
              onOpen={onOpen}
              onToggle={toggle}
              onFocusRow={setFocusId}
              statusTitle={statusItem.get(row.node.record.status)?.title ?? row.node.record.status}
              statusRoll={statusRoll?.get(row.node.id)}
              verdictRoll={verdictRoll?.get(row.node.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ItemProps {
  row: TreeRow;
  config: KitConfig;
  filtered: boolean;
  tabbable: boolean;
  href?: (id: string) => string;
  onOpen?: (id: string) => void;
  onToggle: (id: string, open?: boolean) => void;
  onFocusRow: (id: string) => void;
  statusTitle: string;
  statusRoll?: { done: number; total: number };
  verdictRoll?: ReturnType<typeof rollupVerdict> extends Map<string, infer V> ? V : never;
}

function TreeItem({ row, config, filtered, tabbable, href, onOpen, onToggle, onFocusRow, statusTitle, statusRoll, verdictRoll }: ItemProps) {
  const lang = useKitLang();
  const { node } = row;
  const r = node.record;
  const kind = config.kinds[r.kind];
  const hasKids = row.childTotal > 0;
  const style = { '--tree-depth': node.depth } as CSSProperties;

  const title = href ? (
    <a className="sk-tree__title" href={href(r.id)} tabIndex={-1} onClick={() => onOpen?.(r.id)}>{r.title}</a>
  ) : onOpen ? (
    <button type="button" className="sk-tree__title" tabIndex={-1} onClick={() => onOpen(r.id)}>{r.title}</button>
  ) : (
    <span className="sk-tree__title">{r.title}</span>
  );

  return (
    <li
      role="treeitem"
      className={['sk-tree__row', filtered && !row.matched ? 'is-context' : ''].filter(Boolean).join(' ')}
      style={style}
      data-id={r.id}
      data-match={String(row.matched)}
      aria-level={node.depth + 1}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-expanded={row.childShown > 0 ? row.expanded : undefined}
      aria-selected={false}
      tabIndex={tabbable ? 0 : -1}
      onFocus={e => { if (e.target === e.currentTarget) onFocusRow(r.id); }}
    >
      {hasKids && !filtered ? (
        <IconButton
          icon="play-button"
          iconSize={12}
          tabIndex={-1}
          className={['sk-tree__toggle', row.expanded ? 'is-open' : ''].filter(Boolean).join(' ')}
          label={kitT(lang, row.expanded ? 'kit.tree.collapse' : 'kit.tree.expand', { title: r.title })}
          onClick={() => onToggle(r.id)}
        />
      ) : (
        <span className="sk-tree__spacer" aria-hidden="true" />
      )}
      {kind && <GameIcon slug={kind.icon} size={14} className="sk-tree__kind" />}
      <StatusStar status={r.status} label={kitT(lang, 'kit.tree.status', { status: statusTitle })} size={13} />
      {title}
      <Pill variant="id">{r.id}</Pill>
      {node.orphan && <Pill tone="wrn" title={kitT(lang, 'kit.tree.orphan', { parent: node.orphan })}>{kitT(lang, 'kit.tree.orphan', { parent: node.orphan })}</Pill>}
      {node.cycle && <Pill tone="wrn">{kitT(lang, 'kit.tree.cycle')}</Pill>}
      <span className="sk-tree__meta">
        {filtered && hasKids && (
          <span className="sk-tree__count" title={kitT(lang, 'kit.tree.shownOfTitle', { shown: row.childShown, total: row.childTotal })}>
            {kitT(lang, 'kit.tree.shownOf', { shown: row.childShown, total: row.childTotal })}
          </span>
        )}
        {statusRoll && statusRoll.total > 0 && (
          <Pill tone={statusRoll.done === statusRoll.total ? 'suc' : 't2'} title={kitT(lang, 'kit.tree.rollupStatus', statusRoll)}>
            {`${statusRoll.done}/${statusRoll.total}`}
          </Pill>
        )}
        {verdictRoll?.ownError !== undefined && (
          <Pill tone="dng" title={verdictRoll.ownError}>{kitT(lang, 'kit.tree.verdictError')}</Pill>
        )}
        {verdictRoll && verdictRoll.max > 0 && (
          <Pill
            tone={verdictRoll.failedNodes > 0 ? 'dng' : 'suc'}
            title={[
              kitT(lang, 'kit.tree.rollupVerdict', { score: verdictRoll.score, max: verdictRoll.max, failed: verdictRoll.failedNodes }),
              verdictRoll.errors > 0 ? kitT(lang, 'kit.tree.rollupVerdictErrors', { errors: verdictRoll.errors }) : '',
            ].filter(Boolean).join('. ')}
          >
            {`${verdictRoll.score}/${verdictRoll.max}${verdictRoll.failedNodes > 0 ? ` · ${verdictRoll.failedNodes}` : ''}${verdictRoll.errors > 0 ? ' · !' : ''}`}
          </Pill>
        )}
      </span>
    </li>
  );
}
