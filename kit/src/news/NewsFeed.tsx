// Экран новостей v2 на kit (SPRINT_UXR_S7A_NEWS/S7A-02; S7A-06 — та же лента
// во вкладке «Активность» паспортов). Рисует ответ GET /lore/news/v2; числа
// методики (итоги, сгорание, дельты, матрица) — поля ответа сервера
// (SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0).
//
// Раскладка — S7A-12 (прототип docs/prototypes/s7a-12-news-ui.html, approve
// владелицы 09.11.2026): «это новостная лента, а не дашборд». Лента — первая
// на любой ширине. Над ней одна полоса (период · чипы типов · «Фильтры (N)»)
// и одна тихая строка критичного (сгорание · с прошлого раза · ⚠ сверки).
// Фильтры, группировка, порядок и время — в панели «Фильтры» (на телефоне —
// нижний лист). Карточки метрик, разрез, матрица, сгорание, знания — по
// нажатию «все метрики». Ничего не удалено: всё в одном действии.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { GameIcon } from '../elements/GameIcon';
import { Pill } from '../elements/Pill';
import { useKitLang } from '../i18n';
import type { KitLang } from '../i18n';
import { pushUrlState, readUrlState } from '../resilience/urlState';
import { classifyError, errorDetail } from '../states/loadState';
import { useLoadState } from '../states/useLoadState';
import { EmptyState, Forbidden, LoadError, Skeleton } from '../states/StateViews';
import { newsT, type NewsKey } from './i18n';
import {
  DEFAULT_NEWS_QUERY, NEWS_KIND_META, NEWS_TYPE_META, axisLabel, buildNewsParams, drillLabel, eventAxisValues, kindLabel,
  newsGroupLabel, newsHref, pairText, parseNewsResponse, readNewsQuery, shortDay, shortProject, signTone, signed, typeLabel,
  utcClock, writeNewsQuery, type NewsPeriod, type NewsQuery, type NewsScope, type NewsZone,
} from './model';
import { Delta, NewsPanels, type NewsSection } from './NewsPanels';
import type { NewsSource } from './source';
import {
  NEWS_AXES, NEWS_FILTER_AXES, type NewsAxis, type NewsEvent, type NewsFilterAxis, type NewsReadMark, type NewsResponse,
} from './types';

export interface NewsFeedProps {
  source: NewsSource;
  /** Фиксированный разрез (паспорт, S7A-06): уходит в запрос, пользователь его не снимает. */
  scope?: NewsScope;
  /** Префикс параметров разреза в URL; null — состояние только в памяти. */
  urlPrefix?: string | null;
  /** Пояс «местного» дня; по умолчанию — пояс браузера. */
  timeZone?: string;
  /** Какие блоки показать; по умолчанию все. */
  sections?: readonly NewsSection[];
  /** Ссылка строки; по умолчанию — паспорта LORE (newsHref). null — строка не ведёт никуда. */
  hrefOf?: (e: NewsEvent) => string | null;
  /** Открыть запись без перехода по ссылке (клик, Enter, пробел). */
  onOpen?: (e: NewsEvent) => void;
  /** Заголовок; null — без заголовка (вкладка паспорта). */
  title?: string | null;
  className?: string;
}

export const NEWS_SECTIONS_ALL: readonly NewsSection[] = ['metrics', 'groups', 'matrix', 'burn', 'knowledge', 'feed'];

type T = (k: NewsKey, vars?: Record<string, string | number>) => string;

function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function useNewsQuery(prefix: string | null): [NewsQuery, (patch: Partial<NewsQuery>) => void] {
  const [q, setQ] = useState<NewsQuery>(() => {
    if (prefix === null || typeof window === 'undefined') return DEFAULT_NEWS_QUERY;
    return readNewsQuery(readUrlState(), prefix);
  });
  const update = (patch: Partial<NewsQuery>) => setQ(prev => {
    const next = { ...prev, ...patch };
    if (prefix !== null && typeof window !== 'undefined') pushUrlState(writeNewsQuery(next, prefix), { replace: true });
    return next;
  });
  return [q, update];
}

/** Самая свежая прошедшая строка — до неё двигается черта «прочитано» (паритет 9). */
function newestMoment(d: NewsResponse): string {
  return d.events.find(e => e.at_utc && !e.future)?.at_utc ?? d.meta.generated_at;
}

/** Сколько настроек панели «Фильтры» отличается от исходных — число на кнопке. */
function sheetChanges(q: NewsQuery, fixed: Set<string>): number {
  let n = 0;
  for (const ax of NEWS_FILTER_AXES) if (ax !== 'type' && !fixed.has(ax) && q.filters[ax]?.length) n++;
  if (q.group !== DEFAULT_NEWS_QUERY.group) n++;
  if (q.sub) n++;
  if (q.order !== DEFAULT_NEWS_QUERY.order) n++;
  if (q.zone !== DEFAULT_NEWS_QUERY.zone) n++;
  return n;
}

export function NewsFeed({
  source, scope, urlPrefix = 'n', timeZone, sections = NEWS_SECTIONS_ALL, hrefOf = newsHref, onOpen, title, className,
}: NewsFeedProps) {
  const lang = useKitLang();
  const t: T = (k, vars) => newsT(lang, k, vars);
  const tz = timeZone ?? browserZone();
  const [q, update] = useNewsQuery(urlPrefix);
  const params = buildNewsParams(q, { timeZone: tz, scope });
  const key = params.toString();
  const res = useLoadState<NewsResponse>(
    async signal => parseNewsResponse(await source.load(new URLSearchParams(key), signal)),
    [key, source],
    { rows: d => d.events },
  );
  const [markMsg, setMarkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [validOpen, setValidOpen] = useState(false);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

  /** Нажатие на столбик мини-графика: раскрыть день и прокрутить к нему. */
  const jumpToDay = (day: string) => {
    setOpenDays(o => ({ ...o, [day]: true }));
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-day="${day}"]`);
      el?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      el?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus({ preventScroll: true });
    });
  };

  const data = res.error ? undefined : res.data;
  const fixedAxes = new Set<string>(Object.keys(scope ?? {}).filter(k => k !== 'release'));

  const markRead = async () => {
    if (!data) return;
    setBusy(true);
    setMarkMsg(null);
    try {
      const st: NewsReadMark = await source.setReadMark(newestMoment(data));
      if (st.state !== 'ok') setMarkMsg(t('mark.unavailable', { why: st.error ?? st.state }));
      res.reload();
    } catch (e) {
      setMarkMsg(t('mark.failed', { why: errorDetail(e) }));
    } finally {
      setBusy(false);
    }
  };

  const panels = sections.filter(s => s !== 'feed');
  let body: ReactNode;
  if (res.error !== undefined && res.error !== null) {
    body = classifyError(res.error) === 'forbidden'
      ? <Forbidden reason={errorDetail(res.error)} />
      : <LoadError error={res.error} onRetry={res.reload} />;
  } else if (!data) {
    body = <Skeleton lines={8} />;
  } else {
    body = (
      <>
        <Banners data={data} lang={lang} />
        <Strip data={data} t={t} lang={lang} busy={busy} markMsg={markMsg} onMark={markRead}
          hasPanels={panels.length > 0} metricsOpen={metricsOpen} onMetrics={() => setMetricsOpen(o => !o)}
          validOpen={validOpen} onValid={() => setValidOpen(o => !o)} onJump={jumpToDay} />
        <Filters query={q} update={update} data={data} t={t} lang={lang} fixed={fixedAxes} />
        {validOpen && <Validation data={data} t={t} />}
        {panels.length > 0 && (
          // Свёрнутые метрики остаются в документе (hidden): числа не пропадают,
          // их просто не показывают до нажатия «все метрики».
          <div className="sk-news__more" data-testid="news-more" hidden={!metricsOpen}>
            <NewsPanels data={data} query={q} update={update} sections={panels} fixed={fixedAxes} />
          </div>
        )}
        {sections.includes('feed') && (data.events.length === 0
          ? <EmptyState
              title={Object.keys(q.filters).length || q.els.length ? t('empty.filtered') : t('empty.title')}
              hint={t('empty.hint')}
            />
          : <FeedDays data={data} query={q} lang={lang} tz={q.zone === 'utc' ? 'UTC' : tz} hrefOf={hrefOf} onOpen={onOpen}
              open={openDays} setOpen={setOpenDays} />)}
      </>
    );
  }

  const Root = title === null ? 'div' : 'section';
  return (
    // title=null — лента внутри раздела, который уже назван своим h1: второй
    // ориентир с тем же именем (axe landmark-unique) не нужен — просто блок.
    <Root className={['sk-news', className].filter(Boolean).join(' ')} {...(title === null ? {} : { 'aria-label': title ?? t('title') })}>
      {(title !== null || source.kind === 'fixture' || (scope && Object.keys(scope).length > 0)) && (
        <header className="sk-news__head">
          {title !== null && <h2 className="sk-news__title">{title ?? t('title')}</h2>}
          {source.kind === 'fixture' && (
            <span className="sk-news__fixture" data-testid="news-fixture-badge">{t('fixture')}</span>
          )}
          {scope && Object.keys(scope).length > 0 && (
            <span className="sk-news__scope" data-testid="news-scope">
              <span className="sk-list__label">{t('scope')}</span>
              {Object.entries(scope).map(([k, v]) => (
                <Pill key={k} variant="id">{`${axisLabel(k, lang)}: ${v}`}</Pill>
              ))}
            </span>
          )}
        </header>
      )}
      <Bar query={q} update={update} t={t} lang={lang} fixed={fixedAxes} onSheet={() => setSheet(true)} />
      <Active query={q} update={update} t={t} lang={lang} fixed={fixedAxes} />
      {body}
      {sheet && <Sheet query={q} update={update} data={data} t={t} lang={lang} fixed={fixedAxes} onClose={() => setSheet(false)} />}
    </Root>
  );
}

// ── полоса над лентой: период · чипы типов · «Фильтры (N)» ──

interface CtlProps {
  query: NewsQuery;
  update: (p: Partial<NewsQuery>) => void;
  t: T;
  lang: KitLang;
  fixed: Set<string>;
}

function Radios<V extends string>({ label, value, items, on, testId }: {
  label: string; value: V; items: Array<[V, string]>; on: (v: V) => void; testId?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="sk-list__views" data-testid={testId}>
      {items.map(([v, title]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v}
          className={`sk-list__view${value === v ? ' is-on' : ''}`} onClick={() => on(v)}>{title}</button>
      ))}
    </div>
  );
}

function Bar({ query: q, update, t, fixed, onSheet }: CtlProps & { onSheet: () => void }) {
  const n = sheetChanges(q, fixed);
  return (
    <div className="sk-news__bar" role="toolbar" aria-label={t('feed')} data-testid="news-bar">
      <Radios<NewsPeriod> label={t('period')} value={q.period} testId="news-period"
        items={[['day', t('period.day')], ['week', t('period.week')], ['month', t('period.month')]]}
        on={v => update({ period: v })} />
      <button type="button" className="sk-news__fbtn" data-testid="news-filters-btn" aria-haspopup="dialog"
        aria-label={`${t('more.btn')} · ${t('filters')}`} onClick={onSheet}>
        <GameIcon slug="settings-knobs" size={13} />
        <span>{t('more.btn')}</span>
        {n > 0 && <span className="sk-news__badge">{n}</span>}
      </button>
    </div>
  );
}

/**
 * Варианты фильтра по оси: числа — только присланные сервером (свёртка kind,
 * разрез по этой оси); иначе значения из строк ленты без числа. Общие для
 * быстрых фильтров наверху и панели «Ещё».
 */
function axisOptions(ax: NewsFilterAxis, data: NewsResponse | undefined, q: NewsQuery, lang: KitLang): Array<[string, string, string | null]> {
  const out = new Map<string, [string, string | null]>();
  const pairs = ax === 'kind' ? data?.metrics.counts.by_kind : ax === 'who' ? data?.metrics.counts.by_who : undefined;
  if (pairs) for (const [k, p] of Object.entries(pairs)) out.set(k, [newsGroupLabel(ax, k, lang), pairText(p)]);
  else if (ax === 'author') for (const k of ['agent', 'human', 'unknown']) out.set(k, [newsGroupLabel(ax, k, lang), null]);
  else {
    if (data?.groups.axis === ax) for (const g of data.groups.list) out.set(g.key, [newsGroupLabel(ax, g.key, lang), `${g.events} · ${g.elements}`]);
    for (const e of data?.events ?? []) for (const v of eventAxisValues(e, ax)) if (!out.has(v)) out.set(v, [newsGroupLabel(ax, v, lang), null]);
  }
  for (const v of q.filters[ax] ?? []) if (!out.has(v)) out.set(v, [newsGroupLabel(ax, v, lang), null]);
  return [...out].map(([k, [l, n]]) => [k, l, n]);
}

function toggleFilter(q: NewsQuery, update: (p: Partial<NewsQuery>) => void, ax: NewsFilterAxis, v: string) {
  const next = { ...q.filters };
  if (next[ax]?.length === 1 && next[ax]![0] === v) delete next[ax]; else next[ax] = [v];
  update({ filters: next });
}

/** Быстрые фильтры наверху (владелица 09.11): Проект ▾ · Компонент ▾ · Кто ▾ и типы со счётом. */
const TOP_AXES: readonly NewsFilterAxis[] = ['project', 'component', 'who'];

function Filters({ query: q, update, data, t, lang, fixed }: CtlProps & { data: NewsResponse }) {
  const [pop, setPop] = useState<NewsFilterAxis | null>(null);
  useEffect(() => {
    if (!pop) return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setPop(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pop]);
  const axes = TOP_AXES.filter(a => !fixed.has(a));
  const byType = data.metrics.counts.by_type;
  const typeOn = q.filters.type?.length === 1 ? q.filters.type[0] : null;
  const label = (a: NewsFilterAxis) => (a === 'who' ? t('facet.who') : axisLabel(a, lang));
  // «Кто» — и вид (люди/агенты, ось author), и конкретное имя (ось who, сервер #974).
  const axesOf = (a: NewsFilterAxis): NewsFilterAxis[] => (a === 'who' && !fixed.has('author') ? ['author', 'who'] : [a]);
  return (
    <div className="sk-news__filters" data-testid="news-filters">
      {/* Одна строка с прокруткой вбок: грани и типы вместе — высоту ленты не съедают. */}
      <div className="sk-news__frow">
        {axes.length > 0 && (
          <div className="sk-news__facets" role="group" aria-label={t('facets')}>
            {axes.map(a => {
              const sel = axesOf(a).flatMap(x => (q.filters[x] ?? []).map(v => newsGroupLabel(x, v, lang)));
              return (
                <button key={a} type="button" className="sk-news__fc" data-testid={`news-facet-${a}`}
                  aria-expanded={pop === a} aria-controls={`news-facet-pop-${a}`} data-on={sel.length > 0 || undefined}
                  onClick={() => setPop(p => (p === a ? null : a))}>
                  <span>{label(a)}</span>
                  {sel.length > 0 && <b>{sel.length === 1 ? sel[0] : sel.length}</b>}
                  <span aria-hidden="true">▾</span>
                </button>
              );
            })}
          </div>
        )}
        {!fixed.has('type') && Object.keys(byType).length > 0 && (
          <div className="sk-news__types" role="group" aria-label={`${axisLabel('type', lang)} · ${t('types.period')}`}>
            {Object.entries(byType).map(([k, p]) => (
              <button key={k} type="button" className="sk-news__chip" aria-pressed={typeOn === k}
                data-testid={`news-type-chip-${k}`} title={`${typeLabel(k, lang)} ${t('types.period')}: ${pairText(p)}`}
                onClick={() => toggleFilter(q, update, 'type', k)}>
                <GameIcon slug={NEWS_TYPE_META[k]?.icon ?? 'scroll-quill'} size={13} />
                <span className="sk-news__tlabel">{typeLabel(k, lang)}</span>
                <span className="sk-news__n">{p.events}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {pop && (
        <div className="sk-news__pop" id={`news-facet-pop-${pop}`} role="group" aria-label={label(pop)} data-testid={`news-facet-pop-${pop}`}>
          {axesOf(pop).map(ax => (
            <div key={ax} className="sk-news__popg" role="group" aria-label={axesOf(pop).length > 1 ? t(ax === 'author' ? 'facet.kind' : 'facet.names') : label(pop)}
              data-testid={`news-facet-opts-${ax}`}>
              {axesOf(pop).length > 1 && <span className="sk-list__label">{t(ax === 'author' ? 'facet.kind' : 'facet.names')}</span>}
              {axisOptions(ax, data, q, lang).map(([v, l, n]) => (
                <button key={v} type="button" className="sk-news__chip" title={v}
                  aria-pressed={q.filters[ax]?.length === 1 && q.filters[ax]![0] === v}
                  onClick={() => { toggleFilter(q, update, ax, v); setPop(null); }}>
                  <span>{l}</span>
                  {n && <span className="sk-news__n">{n}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Активные фильтры — чипами с ✕ (вместо строки «Фильтр: …»), сброс одной кнопкой. */
function Active({ query: q, update, t, lang, fixed }: CtlProps) {
  const chips: Array<{ key: string; text: string; off: () => void }> = [];
  for (const ax of NEWS_FILTER_AXES) {
    if (fixed.has(ax)) continue;
    for (const v of q.filters[ax] ?? []) {
      chips.push({
        key: `${ax}:${v}`, text: `${axisLabel(ax, lang)}: ${newsGroupLabel(ax, v, lang)}`,
        off: () => { const next = { ...q.filters }; delete next[ax]; update({ filters: next }); },
      });
    }
  }
  if (q.els.length) {
    chips.push({
      key: 'els',
      text: q.drill
        ? t('drill.desc', { metric: drillLabel(q.drill.metric, lang), shown: q.els.length, total: q.drill.total })
        : q.els.join(' | '),
      off: () => update({ els: [], drill: null }),
    });
  }
  const d = DEFAULT_NEWS_QUERY;
  if (q.group !== d.group || q.sub) {
    chips.push({
      key: 'group', text: `${t('desc.group')}: ${axisLabel(q.group, lang)}${q.sub ? ` → ${axisLabel(q.sub, lang)}` : ''}`,
      off: () => update({ group: d.group, sub: null }),
    });
  }
  if (q.order !== d.order) chips.push({ key: 'order', text: `${t('order')}: ${t(`order.${q.order}` as NewsKey)}`, off: () => update({ order: d.order }) });
  if (q.zone !== d.zone) chips.push({ key: 'zone', text: `${t('zone')}: ${t(`zone.${q.zone}` as NewsKey)}`, off: () => update({ zone: d.zone }) });
  const drillPartial = q.drill && q.els.length && q.els.length < q.drill.total ? q.drill : null;
  if (!chips.length) return null;
  return (
    <>
      <div className="sk-news__active" data-testid="news-desc">
        {chips.map(c => (
          <span key={c.key} className="sk-news__achip">
            <span>{c.text}</span>
            <button type="button" className="sk-news__x" aria-label={t('remove', { what: c.text })} onClick={c.off}>✕</button>
          </span>
        ))}
        <button type="button" className="sk-btn" onClick={() => update({ filters: {}, els: [], drill: null, group: d.group, sub: null, order: d.order, zone: d.zone })}>
          {t('reset')}
        </button>
      </div>
      {drillPartial && (
        <p className="sk-news__banner" data-tone="wrn" data-testid="news-drill-partial">
          {t('drill.partial', { shown: q.els.length, total: drillPartial.total })}
        </p>
      )}
    </>
  );
}

// ── панель «Фильтры»: справа на широком экране, нижний лист на телефоне ──

const ALL_AXES_FOR_SHEET: readonly NewsFilterAxis[] = ['project', 'component', 'sprint', 'milestone', 'author', 'who', 'kind'];

function Sheet({ query: q, update, data, t, lang, fixed, onClose }: CtlProps & { data: NewsResponse | undefined; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const authorPending = data?.metrics.agents.measurable === false;
  const axisOpt = (a: NewsAxis) => (a === 'author' && authorPending ? `${axisLabel(a, lang)} (${t('axis.author.pending')})` : axisLabel(a, lang));

  const options = (ax: NewsFilterAxis) => axisOptions(ax, data, q, lang);
  const toggle = (ax: NewsFilterAxis, v: string) => toggleFilter(q, update, ax, v);

  return (
    <>
      <div className="sk-news__scrim" onClick={onClose} aria-hidden="true" />
      <aside className="sk-news__sheet" role="dialog" aria-modal="true" aria-label={t('filters')} data-testid="news-sheet">
        <span className="sk-news__grip" aria-hidden="true" />
        <header className="sk-news__sheeth">
          <h3 className="sk-news__pt">{t('filters')}</h3>
          <button type="button" className="sk-btn" onClick={() => update({ filters: {}, els: [], drill: null, group: DEFAULT_NEWS_QUERY.group, sub: null, order: DEFAULT_NEWS_QUERY.order, zone: DEFAULT_NEWS_QUERY.zone })}>{t('reset')}</button>
          <button type="button" className="sk-btn" aria-label={t('sheet.close')} onClick={onClose}>✕</button>
        </header>
        <div className="sk-news__sheetb">
          <section className="sk-news__fs">
            <h4 className="sk-list__label">{t('group')}</h4>
            <div role="radiogroup" aria-label={t('group')} className="sk-news__wrap">
              {NEWS_AXES.map(a => (
                <button key={a} type="button" role="radio" aria-checked={q.group === a} className="sk-news__chip"
                  data-testid={`news-group-opt-${a}`} onClick={() => update({ group: a, sub: q.sub === a ? null : q.sub })}>{axisOpt(a)}</button>
              ))}
            </div>
            <h4 className="sk-list__label">{t('sub')}</h4>
            <div role="radiogroup" aria-label={t('sub')} className="sk-news__wrap" data-testid="news-sub">
              <button type="button" role="radio" aria-checked={!q.sub} className="sk-news__chip" onClick={() => update({ sub: null })}>{t('sub.none')}</button>
              {NEWS_AXES.filter(a => a !== q.group).map(a => (
                <button key={a} type="button" role="radio" aria-checked={q.sub === a} className="sk-news__chip"
                  onClick={() => update({ sub: a })}>{axisOpt(a)}</button>
              ))}
            </div>
          </section>
          <section className="sk-news__fs">
            <h4 className="sk-list__label">{t('order')}</h4>
            <Radios<'desc' | 'asc'> label={t('order')} value={q.order} testId="news-order"
              items={[['desc', t('order.desc')], ['asc', t('order.asc')]]} on={v => update({ order: v })} />
          </section>
          {ALL_AXES_FOR_SHEET.filter(ax => !fixed.has(ax)).map(ax => (
            <section key={ax} className="sk-news__fs">
              <h4 className="sk-list__label">{axisLabel(ax, lang)}</h4>
              <div role="group" aria-label={axisLabel(ax, lang)} className="sk-news__wrap" data-testid={`news-filter-${ax}`}>
                {options(ax).map(([v, label, n]) => {
                  const on = q.filters[ax]?.length === 1 && q.filters[ax]![0] === v;
                  return (
                    <button key={v} type="button" className="sk-news__chip" aria-pressed={on} title={v} onClick={() => toggle(ax, v)}>
                      {ax === 'kind' && NEWS_KIND_META[v] && <GameIcon slug={NEWS_KIND_META[v].icon} size={12} />}
                      <span>{label}</span>
                      {n && <span className="sk-news__n">{n}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          <section className="sk-news__fs">
            <h4 className="sk-list__label">{t('zone')}</h4>
            <Radios<NewsZone> label={t('zone')} value={q.zone} testId="news-zone"
              items={[['local', t('zone.local')], ['utc', t('zone.utc')]]} on={v => update({ zone: v })} />
          </section>
        </div>
        <footer className="sk-news__sheetf">
          <button type="button" className="sk-btn sk-btn--primary" onClick={onClose}>{t('sheet.show')}</button>
        </footer>
      </aside>
    </>
  );
}

// ── строка критичного над лентой (владелица 09.11: на виду — критичное) ──

/**
 * Мини-график сгорания по дням периода (владелица 09.11: «мини-графики на
 * самом верху»). Высота столбика — burn дня из tasks.days, ничего не считаем.
 * День периода без строки в tasks.days — «нет данных» штриховкой, а не нулём:
 * «не смогли посчитать» ≠ «ничего не закрыли».
 */
function Spark({ data, t, onJump }: { data: NewsResponse; t: T; onJump: (day: string) => void }) {
  const tasks = data.metrics.tasks;
  if (!tasks.available) return null;
  const byDay = new Map(tasks.days.map(d => [d.day_local, d.burn]));
  const days = [...new Set([...tasks.days.map(d => d.day_local), ...(data.matrix?.rows.map(r => r.day) ?? [])])].sort();
  if (days.length < 2) return null;
  const max = Math.max(1, ...tasks.days.map(d => Math.abs(d.burn)));
  return (
    <div className="sk-news__spark" role="group" aria-label={t('spark')} data-testid="news-spark">
      {days.map(day => {
        const v = byDay.get(day);
        const label = v === undefined ? t('spark.nodata', { day }) : t('spark.day', { day, v: signed(v) });
        return (
          <button key={day} type="button" className="sk-news__sbar" data-testid={`news-spark-${day}`}
            data-state={v === undefined ? 'none' : v === 0 ? 'zero' : undefined} data-tone={v === undefined ? undefined : signTone(v)}
            style={v ? { '--h': `${Math.max(12, Math.round((Math.abs(v) / max) * 100))}%` } as CSSProperties : undefined}
            title={label} aria-label={label} onClick={() => onJump(day)} />
        );
      })}
    </div>
  );
}

function Strip({ data, t, lang, busy, markMsg, onMark, hasPanels, metricsOpen, onMetrics, validOpen, onValid, onJump }: {
  data: NewsResponse; t: T; lang: KitLang; busy: boolean; markMsg: string | null; onMark: () => void;
  hasPanels: boolean; metricsOpen: boolean; onMetrics: () => void; validOpen: boolean; onValid: () => void;
  onJump: (day: string) => void;
}) {
  const m = data.metrics;
  const tasks = m.tasks;
  const mark = data.meta.read_mark;
  const markOk = mark?.state === 'ok' || mark?.state === 'none';
  const since = m.since_mark;
  const checks = data.meta.validation.checks.filter(c => c.ok !== true).length;
  return (
    <div className="sk-news__strip" data-testid="news-strip" aria-label={t('strip')} role="group">
      <Spark data={data} t={t} onJump={onJump} />
      {tasks.available && (
        <span className="sk-news__sm" data-testid="news-strip-burn" data-tone={signTone(tasks.all.burn)}>
          <GameIcon slug="flame" size={13} />
          <b>{signed(tasks.all.burn)}</b>
          <span>{t('strip.burn')}</span>
          <Delta d={m.delta.burn} t={t} lang={lang} prev={m.delta.previous} />
        </span>
      )}
      <span className="sk-news__sm">
        <span className="sk-news__since" data-testid="news-since">
          {since ? t('since', { ev: since.events, el: since.elements }) : t('since.none')}
        </span>
        <button type="button" className="sk-news__linkbtn" data-testid="news-mark-read" disabled={!markOk || busy} onClick={onMark}>
          {t('markRead')}
        </button>
        {!markOk && (
          <span className="sk-news__warn" data-testid="news-mark-unavailable">
            {t('mark.unavailable', { why: mark?.error ?? mark?.state ?? '—' })}
          </span>
        )}
        {markMsg && <span className="sk-news__warn" role="status">{markMsg}</span>}
      </span>
      <span className="sk-news__sp" />
      {checks > 0 && (
        <button type="button" className="sk-news__vbtn" data-testid="news-valid-btn" aria-expanded={validOpen}
          data-tone={data.meta.validation.checks.some(c => c.ok === false) ? 'dng' : 'wrn'}
          title={t('valid.btn', { n: checks })} aria-label={t('valid.btn', { n: checks })} onClick={onValid}>
          {`⚠ ${checks}`}
        </button>
      )}
      {hasPanels && (
        <button type="button" className="sk-news__linkbtn" data-testid="news-strip-toggle" aria-expanded={metricsOpen}
          aria-controls="news-more" onClick={onMetrics}>
          {metricsOpen ? `▴ ${t('strip.less')}` : `▾ ${t('strip.more')}`}
        </button>
      )}
    </div>
  );
}

// ── плашки состояния ответа (S7A-07): сбой источника и обрезка видны всегда ──

function Banners({ data, lang }: { data: NewsResponse; lang: KitLang }) {
  const t = (k: NewsKey, vars?: Record<string, string | number>) => newsT(lang, k, vars);
  const m = data.meta;
  return (
    <>
      {(m.state === 'partial' || m.errors.length > 0) && (
        <div className="sk-news__banner" data-tone="wrn" data-testid="news-partial" role="status">
          <strong>{t('partial')}</strong>
          <ul className="sk-news__blist">
            {m.errors.map(e => (
              <li key={e.source}>
                <code>{e.source}</code>{e.critical ? ` · ${t('partial.critical')}` : ''} — {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.truncated && <div className="sk-news__banner" data-tone="wrn" data-testid="news-truncated">{t('truncated')}</div>}
    </>
  );
}

/** Сверка чисел — диагностика: по нажатию ⚠ в строке критичного. Провал — красным. */
function Validation({ data, t }: { data: NewsResponse; t: T }) {
  const bad = data.meta.validation.checks.filter(c => c.ok === false);
  const unknown = data.meta.validation.checks.filter(c => c.ok === null);
  return (
    <div className="sk-news__banner" data-tone={bad.length ? 'dng' : 'wrn'} data-testid="news-validation">
      <strong>{t('validation')}</strong>
      {bad.length > 0 && <span> — {t('validation.fail')}</span>}
      <ul className="sk-news__blist">
        {bad.map((c, i) => (
          <li key={`f${i}`} data-check-state="fail">{`§${c.inv} ${c.name}: ${c.detail}`}</li>
        ))}
        {unknown.map((c, i) => (
          <li key={`u${i}`} data-check-state="unknown">{`${t('validation.unknown')} · §${c.inv} ${c.name}: ${c.detail}`}</li>
        ))}
      </ul>
    </div>
  );
}

// ── лента по дням ──

interface FeedProps {
  data: NewsResponse;
  query: NewsQuery;
  lang: KitLang;
  tz: string;
  hrefOf: (e: NewsEvent) => string | null;
  onOpen?: (e: NewsEvent) => void;
}

/** Критичные цифры дня (набор утвердила владелица 09.11.2026) — цветными чипами. */
const CRIT_KINDS = ['ready', 'reactivated', 'released'] as const;

/**
 * Цифры дня, вариант C (выбор владелицы 09.11.2026): полоса баланса
 * «закрыто против заведено» + чипы — критичные цветом, информационные серым.
 * Сгорание и итог — поля ответа (tasks.days, matrix.rows); счёты по видам и
 * типам — счёт строк этого дня, то есть подпись того, что нарисовано ниже,
 * а не метрика методики (допущение принято с approve прототипа 09.11).
 */
function DayFigures({ day, events, data, t, lang }: { day: string; events: NewsEvent[]; data: NewsResponse; t: T; lang: KitLang }) {
  const byKind = new Map<string, number>();
  const byType = new Map<string, number>();
  let tasksCreated = 0;
  for (const e of events) {
    byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
    byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    if (e.type === 'task' && e.kind === 'created') tasksCreated++;
  }
  const closed = byKind.get('closed') ?? 0;
  const burn = data.metrics.tasks.available ? data.metrics.tasks.days.find(d => d.day_local === day) : undefined;
  const total = data.matrix?.rows.find(r => r.day === day)?.total;
  const otherCreated = (byKind.get('created') ?? 0) - tasksCreated;
  const showBal = closed + tasksCreated > 0 || (burn && burn.burn !== 0);
  const share = closed + tasksCreated > 0 ? Math.round((closed / (closed + tasksCreated)) * 100) : 0;
  const balText = t('bal', { cl: closed, cr: tasksCreated });
  const chip = (id: string, n: number, label: string, icon: string, tone: string) => (
    <span key={id} className="sk-news__dchip" data-testid={id} data-tone={tone} title={label}>
      <GameIcon slug={icon} size={11} />
      <b>{n}</b>
      <span>{label}</span>
    </span>
  );
  const crit = CRIT_KINDS.flatMap(k => {
    const n = byKind.get(k);
    return n ? [chip(`news-cube-kind-${k}`, n, t(`cube.${k}` as NewsKey), NEWS_KIND_META[k].icon, NEWS_KIND_META[k].tone)] : [];
  });
  return (
    <div className="sk-news__figs">
      {showBal && (
        <div className="sk-news__bal">
          {burn && (
            <span className="sk-news__bburn" data-testid="news-cube-burn" data-tone={signTone(burn.burn)} title={t('cube.burn')}>
              <GameIcon slug="flame" size={12} />
              <b>{signed(burn.burn)}</b>
            </span>
          )}
          <span className="sk-news__balbar" role="img" aria-label={balText}>
            <span data-part="closed" style={{ width: `${share}%` }} />
            <span data-part="created" style={{ width: `${100 - share}%` }} />
          </span>
          <span className="sk-news__ball">
            <span data-testid="news-cube-kind-closed">{`${closed} ${t('cube.closed')}`}</span>
            {' · '}
            <span data-testid="news-cube-kind-created">{`${tasksCreated} ${t('cube.created')}`}</span>
          </span>
        </div>
      )}
      <div className="sk-news__dchips">
        {crit}
        {total && (
          <span className="sk-news__dchip" data-testid="news-cube-total" title={t('pair')}>
            <span data-testid="news-day-total">{pairText(total)}</span>
          </span>
        )}
        {otherCreated > 0 && (
          <span className="sk-news__dchip" title={t('cube.other')}>
            <GameIcon slug={NEWS_KIND_META.created.icon} size={11} />{otherCreated}
          </span>
        )}
        {(byKind.get('changed') ?? 0) > 0 && (
          <span className="sk-news__dchip" title={t('cube.changed')}>
            <GameIcon slug={NEWS_KIND_META.changed.icon} size={11} />{byKind.get('changed')}
          </span>
        )}
        {total && <span className="sk-news__dchip" data-testid="news-cube-delta" title={t('cube.delta')}>{`Δ ${total.elements}`}</span>}
        <span className="sk-news__ftypes" data-testid="news-day-types" title={t('day.types')}>
          {[...byType].map(([k, n]) => (
            <span key={k} title={typeLabel(k, lang)}><GameIcon slug={NEWS_TYPE_META[k]?.icon ?? 'scroll-quill'} size={11} />{n}</span>
          ))}
        </span>
      </div>
    </div>
  );
}

function FeedDays({ data, query: q, lang, tz, hrefOf, onOpen, open, setOpen }: FeedProps & {
  open: Record<string, boolean>; setOpen: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  const t: T = (k, vars) => newsT(lang, k, vars);
  const days = useMemo(() => {
    const m = new Map<string, NewsEvent[]>();
    for (const e of data.events) {
      const list = m.get(e.day_local);
      if (list) list.push(e); else m.set(e.day_local, [e]);
    }
    const out = [...m];
    return q.order === 'asc' ? out.reverse().map(([d, es]) => [d, [...es].reverse()] as const) : out;
  }, [data.events, q.order]);
  const axis = data.groups.axis;
  const rank = new Map(data.groups.list.map((g, i) => [g.key, i]));
  // Черта «прочитано до сюда» (S7A-04): после последнего дня с непрочитанным —
  // только при новых сверху и поставленной черте. Счётчиков не добавляет.
  const markOk = data.meta.read_mark?.state === 'ok';
  let lastUnread = -1;
  if (markOk && q.order === 'desc') days.forEach(([, es], i) => { if (es.some(e => e.unread)) lastUnread = i; });
  const showLine = lastUnread >= 0 && lastUnread < days.length - 1;

  return (
    <div className="sk-news__days" data-testid="news-feed-days">
      {days.map(([day, events], i) => {
        const isOpen = open[day] ?? i < 2;
        const total = data.matrix?.rows.find(r => r.day === day)?.total;
        return (
          <div key={day} className="sk-news__dayw">
            <section className="sk-news__day" data-testid={`news-day-${day}`} data-day={day}>
              <h3 className="sk-news__dayh">
                <button type="button" className="sk-news__daybtn" aria-expanded={isOpen}
                  onClick={() => setOpen(o => ({ ...o, [day]: !isOpen }))}>
                  <span className="sk-news__chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  <span className="sk-news__dayname">{shortDay(day)}</span>
                  <span className="sk-news__dayiso">{day}</span>
                  {!isOpen && total && <span className="sk-news__daytotal" title={t('pair')}>{pairText(total)}</span>}
                </button>
              </h3>
              {isOpen && <DayFigures day={day} events={events} data={data} t={t} lang={lang} />}
              {isOpen && (axis === 'day'
                ? <ul className="sk-news__rows">{events.map(e => <Row key={e.key} e={e} lang={lang} tz={tz} hrefOf={hrefOf} onOpen={onOpen} />)}</ul>
                : <Buckets day={day} events={events} axis={axis} rank={rank} lang={lang} tz={tz} hrefOf={hrefOf} onOpen={onOpen} />)}
            </section>
            {showLine && i === lastUnread && (
              <div className="sk-news__readline" role="separator" data-testid="news-read-line"
                aria-label={`${t('readLine')} · ${data.meta.read_mark?.at ?? ''}`}>
                <span>{`${t('readLine')} · ${(data.meta.read_mark?.at ?? '').slice(0, 16).replace('T', ' ')}`}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface BucketsProps extends Omit<FeedProps, 'data' | 'query'> {
  day: string;
  events: NewsEvent[];
  axis: NewsAxis;
  rank: Map<string, number>;
}

function Buckets({ day, events, axis, rank, lang, tz, hrefOf, onOpen }: BucketsProps) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const buckets = new Map<string, NewsEvent[]>();
  for (const e of events) {
    for (const v of new Set(eventAxisValues(e, axis))) {
      const list = buckets.get(v);
      if (list) list.push(e); else buckets.set(v, [e]);
    }
  }
  const keys = [...buckets.keys()].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
  return (
    <div className="sk-news__buckets">
      {keys.map(k => {
        const isOpen = !closed[k];
        const list = buckets.get(k)!;
        return (
          <div key={k} className="sk-news__bucket" data-testid={`news-bucket-${k}`}>
            <h4 className="sk-news__bh">
              <button type="button" className="sk-news__bbtn" aria-expanded={isOpen}
                onClick={() => setClosed({ ...closed, [k]: isOpen })}>
                <span className="sk-news__chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span>{newsGroupLabel(axis, k, lang)}</span>
                <span className="sk-news__bn">{list.length}</span>
              </button>
            </h4>
            {isOpen && (
              <ul className="sk-news__rows">
                {list.map(e => <Row key={`${day}|${k}|${e.key}`} e={e} lang={lang} tz={tz} hrefOf={hrefOf} onOpen={onOpen} />)}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface RowProps {
  e: NewsEvent;
  lang: KitLang;
  tz: string;
  hrefOf: (e: NewsEvent) => string | null;
  onOpen?: (e: NewsEvent) => void;
}

function Row({ e, lang, tz, hrefOf, onOpen }: RowProps) {
  const t = (k: NewsKey, vars?: Record<string, string | number>) => newsT(lang, k, vars);
  const km = NEWS_KIND_META[e.kind] ?? { icon: 'pencil', tone: 't2' as const };
  const href = hrefOf(e);
  const utc = utcClock(e.at_utc, e.day_local);
  const open = (ev: MouseEvent | KeyboardEvent) => {
    if (!onOpen) return;
    ev.preventDefault();
    onOpen(e);
  };
  const onKey = (ev: KeyboardEvent<HTMLAnchorElement>) => {
    if (ev.key === 'Enter') open(ev);
    else if (ev.key === ' ') {
      // Пробел на ссылке браузер сам не нажимает — делаем это (паритет 29).
      if (onOpen) open(ev);
      else { ev.preventDefault(); ev.currentTarget.click(); }
    }
  };
  const main = (
    <>
      <GameIcon slug={NEWS_TYPE_META[e.type]?.icon ?? 'scroll-quill'} size={14} label={typeLabel(e.type, lang)} />
      {/* Слот одной ширины: плашка своей ширины, заголовки — с одной линии (владелица 09.11). */}
      <span className="sk-news__tagslot">
        <span className="sk-news__tag" data-kind-tag={e.kind} data-tone={km.tone}
          style={{ '--pill-c': `var(--${km.tone})` } as CSSProperties}>
          <GameIcon slug={km.icon} size={12} />
          {kindLabel(e.kind, lang)}
        </span>
      </span>
      <span className="sk-news__rtitle">{e.title ?? e.el}</span>
    </>
  );
  return (
    <li className="sk-news__row" data-testid={`news-row-${e.key}`} data-type={e.type} data-unread={e.unread ? 'true' : undefined}>
      {href !== null || onOpen
        ? <a className="sk-news__link" href={href ?? '#'} onClick={open} onKeyDown={onKey}>{main}</a>
        : <span className="sk-news__link is-static">{main}</span>}
      <span className="sk-news__meta">
        {e.unread && <span className="sk-news__unread">{t('unread')}</span>}
        <Pill variant="id">{e.el}</Pill>
        {e.time_local
          ? <span className="sk-news__time" title={t('time.local.hint', { tz })} data-testid="news-time-local">{e.time_local}</span>
          : <span className="sk-news__time is-none" title={t('time.none.hint')} data-testid="news-time-none">{t('time.none')}</span>}
        {utc && <span className="sk-news__utc" title={t('time.utc.hint')} data-testid="news-time-utc">{`${utc} UTC`}</span>}
        {(e.projects ?? []).map(p => <span key={p} className="sk-news__proj" title={p}>{shortProject(p)}</span>)}
        {(e.from || e.to) && e.type === 'task' && (
          <span className="sk-news__status">{`${e.from ?? '∅'} → ${e.to ?? '∅'}`}</span>
        )}
        {e.mult > 1 && <span className="sk-news__mult" title={t('mult.hint', { n: e.mult })} data-testid="news-mult">{`×${e.mult}`}</span>}
        {e.groups_n > 1 && (
          <span className="sk-news__gn" title={t('groupsN.hint', { n: e.groups_n })} data-testid="news-groups-n">{`×${e.groups_n}`}</span>
        )}
        {e.future && <span data-testid="news-future"><Pill tone="wrn" title={t('future.hint')}>{t('future')}</Pill></span>}
      </span>
    </li>
  );
}

/** Вкладка «Активность» паспорта проекта/вехи/спринта/релиза (S7A-06): та же лента, разрез зафиксирован. */
export function NewsActivity(props: Omit<NewsFeedProps, 'scope' | 'title'> & { scope: NewsScope }) {
  return (
    <NewsFeed
      urlPrefix="a"
      sections={['metrics', 'groups', 'burn', 'feed']}
      title={null}
      {...props}
    />
  );
}
