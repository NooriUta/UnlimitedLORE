// Экран новостей v2 на kit (SPRINT_UXR_S7A_NEWS/S7A-02; S7A-06 — та же лента
// во вкладке «Активность» паспортов). Рисует ответ GET /lore/news/v2 и ни
// одного числа не считает сам (SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0): итоги
// дней, групп, сгорание, матрица и дельты — поля ответа сервера.
//
// Строка «фильтр / группировка / порядок» — тот же вид, что у ListView kit
// (классы sk-list__*): один язык управления на всех экранах v2.
import { useMemo, useState } from 'react';
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
  newsGroupLabel, newsHref, parseNewsResponse, readNewsQuery, shortDay, shortProject, typeLabel, utcClock,
  writeNewsQuery, type NewsPeriod, type NewsQuery, type NewsScope, type NewsZone,
} from './model';
import { NewsPanels, type NewsSection } from './NewsPanels';
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

export function NewsFeed({
  source, scope, urlPrefix = 'n', timeZone, sections = NEWS_SECTIONS_ALL, hrefOf = newsHref, onOpen, title, className,
}: NewsFeedProps) {
  const lang = useKitLang();
  const t = (k: NewsKey, vars?: Record<string, string | number>) => newsT(lang, k, vars);
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
        <NewsPanels data={data} query={q} update={update} sections={sections} fixed={fixedAxes} />
        {sections.includes('feed') && (data.events.length === 0
          ? <EmptyState
              title={Object.keys(q.filters).length || q.els.length ? t('empty.filtered') : t('empty.title')}
              hint={t('empty.hint')}
            />
          : <FeedDays data={data} query={q} lang={lang} tz={q.zone === 'utc' ? 'UTC' : tz} hrefOf={hrefOf} onOpen={onOpen} />)}
      </>
    );
  }

  const mark = data?.meta.read_mark;
  const markOk = mark?.state === 'ok' || mark?.state === 'none';
  const since = data?.metrics.since_mark;

  return (
    <section className={['sk-news', className].filter(Boolean).join(' ')} aria-label={title ?? t('title')}>
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
        {data && (
          <span className="sk-news__mark">
            <span className="sk-news__since" data-testid="news-since">
              {since ? t('since', { ev: since.events, el: since.elements }) : t('since.none')}
            </span>
            <button type="button" className="sk-btn" disabled={!markOk || busy} onClick={markRead}>{t('markRead')}</button>
            {!markOk && (
              <span className="sk-news__warn" data-testid="news-mark-unavailable">
                {t('mark.unavailable', { why: mark?.error ?? mark?.state ?? '—' })}
              </span>
            )}
            {markMsg && <span className="sk-news__warn" role="status">{markMsg}</span>}
          </span>
        )}
      </header>
      <Controls query={q} update={update} data={data} lang={lang} fixed={fixedAxes} />
      {body}
    </section>
  );
}

// ── строка управления ──

interface ControlsProps {
  query: NewsQuery;
  update: (p: Partial<NewsQuery>) => void;
  data: NewsResponse | undefined;
  lang: KitLang;
  fixed: Set<string>;
}

const ALL = '\u0000all';

function Controls({ query: q, update, data, lang, fixed }: ControlsProps) {
  const t = (k: NewsKey, vars?: Record<string, string | number>) => newsT(lang, k, vars);
  const authorPending = data?.metrics.agents.measurable === false;
  const filterAxes = NEWS_FILTER_AXES.filter(a => !fixed.has(a));

  const options = (ax: NewsFilterAxis): Array<[string, string]> => {
    const out = new Map<string, string>();
    const pairs = ax === 'type' ? data?.metrics.counts.by_type : ax === 'kind' ? data?.metrics.counts.by_kind : undefined;
    if (pairs) for (const [k, p] of Object.entries(pairs)) out.set(k, `${newsGroupLabel(ax, k, lang)} · ${p.events} · ${p.elements}`);
    else if (ax === 'author') for (const k of ['agent', 'human', 'unknown']) out.set(k, newsGroupLabel(ax, k, lang));
    else {
      // Числа у опции — только если сервер прислал разрез по этой оси.
      if (data?.groups.axis === ax) for (const g of data.groups.list) out.set(g.key, `${newsGroupLabel(ax, g.key, lang)} · ${g.events} · ${g.elements}`);
      for (const e of data?.events ?? []) for (const v of eventAxisValues(e, ax)) if (!out.has(v)) out.set(v, newsGroupLabel(ax, v, lang));
    }
    for (const v of q.filters[ax] ?? []) if (!out.has(v)) out.set(v, newsGroupLabel(ax, v, lang));
    return [...out];
  };

  const setFilter = (ax: NewsFilterAxis, v: string) => {
    const next = { ...q.filters };
    if (v === ALL) delete next[ax]; else next[ax] = [v];
    update({ filters: next });
  };

  const descParts: string[] = [];
  for (const ax of NEWS_FILTER_AXES) {
    const vs = q.filters[ax];
    if (vs?.length) descParts.push(`${axisLabel(ax, lang)}: ${vs.map(v => newsGroupLabel(ax, v, lang)).join(' | ')}`);
  }
  // Клик по числу метрики (S7A-03): подпись называет метрику, а не сырые ключи.
  if (q.els.length) {
    descParts.push(q.drill
      ? t('drill.desc', { metric: drillLabel(q.drill.metric, lang), shown: q.els.length, total: q.drill.total })
      : q.els.join(' | '));
  }
  const drillPartial = q.drill && q.els.length && q.els.length < q.drill.total ? q.drill : null;
  const hasFilter = descParts.length > 0;
  const axisOpt = (a: NewsAxis) => (a === 'author' && authorPending ? `${axisLabel(a, lang)} (${t('axis.author.pending')})` : axisLabel(a, lang));

  const radios = <V extends string>(label: string, value: V, items: Array<[V, string]>, on: (v: V) => void) => (
    <div role="radiogroup" aria-label={label} className="sk-list__views">
      {items.map(([v, title]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v}
          className={`sk-list__view${value === v ? ' is-on' : ''}`} onClick={() => on(v)}>{title}</button>
      ))}
    </div>
  );

  return (
    <div className="sk-news__controls">
      <div className="sk-list__bar">
        {radios<NewsPeriod>(t('period'), q.period,
          [['day', t('period.day')], ['week', t('period.week')], ['month', t('period.month')]], v => update({ period: v }))}
        {radios<NewsZone>(t('zone'), q.zone, [['local', t('zone.local')], ['utc', t('zone.utc')]], v => update({ zone: v }))}
      </div>
      <div role="group" aria-label={t('filters')} className="sk-list__controls">
        {filterAxes.map(ax => (
          <label key={ax} className="sk-list__field">
            <span className="sk-list__label">{axisLabel(ax, lang)}</span>
            <select aria-label={axisLabel(ax, lang)} className="sk-list__select"
              value={q.filters[ax]?.[0] ?? ALL} onChange={e => setFilter(ax, e.target.value)}>
              <option value={ALL}>{t('filter.all')}</option>
              {options(ax).map(([v, title]) => <option key={v} value={v}>{title}</option>)}
            </select>
          </label>
        ))}
        <label className="sk-list__field">
          <span className="sk-list__label">{t('group')}</span>
          <select aria-label={t('group')} className="sk-list__select" value={q.group}
            onChange={e => update({ group: e.target.value as NewsAxis })}>
            {NEWS_AXES.map(a => <option key={a} value={a}>{axisOpt(a)}</option>)}
          </select>
        </label>
        <label className="sk-list__field">
          <span className="sk-list__label">{t('sub')}</span>
          <select aria-label={t('sub')} className="sk-list__select" value={q.sub ?? ''}
            onChange={e => update({ sub: (e.target.value || null) as NewsAxis | null })}>
            <option value="">{t('sub.none')}</option>
            {NEWS_AXES.filter(a => a !== q.group).map(a => <option key={a} value={a}>{axisOpt(a)}</option>)}
          </select>
        </label>
        <button type="button" className="sk-list__dir" aria-pressed={q.order === 'asc'}
          onClick={() => update({ order: q.order === 'asc' ? 'desc' : 'asc' })}>{t('order.asc')}</button>
      </div>
      <p className="sk-list__desc" data-testid="news-desc">
        <span>
          {`${t('desc.filter')}: ${hasFilter ? descParts.join(' · ') : t('desc.none')} · `}
          {`${t('desc.group')}: ${axisLabel(q.group, lang)}${q.sub ? ` → ${axisLabel(q.sub, lang)}` : ''} · `}
          {`${t('desc.order')}: ${q.order === 'asc' ? t('order.asc') : t('order.desc')}`}
        </span>
        {hasFilter && <button type="button" className="sk-btn" onClick={() => update({ filters: {}, els: [], drill: null })}>{t('reset')}</button>}
      </p>
      {drillPartial && (
        <p className="sk-news__banner" data-tone="wrn" data-testid="news-drill-partial">
          {t('drill.partial', { shown: q.els.length, total: drillPartial.total })}
        </p>
      )}
    </div>
  );
}

// ── плашки состояния ответа (S7A-07) ──

function Banners({ data, lang }: { data: NewsResponse; lang: KitLang }) {
  const t = (k: NewsKey, vars?: Record<string, string | number>) => newsT(lang, k, vars);
  const m = data.meta;
  const bad = m.validation.checks.filter(c => c.ok === false);
  const unknown = m.validation.checks.filter(c => c.ok === null);
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
      {(bad.length > 0 || unknown.length > 0) && (
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
      )}
    </>
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

function FeedDays({ data, query: q, lang, tz, hrefOf, onOpen }: FeedProps) {
  const t = (k: NewsKey, vars?: Record<string, string | number>) => newsT(lang, k, vars);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const days = useMemo(() => {
    const m = new Map<string, NewsEvent[]>();
    for (const e of data.events) {
      const list = m.get(e.day_local);
      if (list) list.push(e); else m.set(e.day_local, [e]);
    }
    const out = [...m];
    return q.order === 'asc' ? out.reverse().map(([d, es]) => [d, [...es].reverse()] as const) : out;
  }, [data.events, q.order]);
  const dayTotal = new Map((data.matrix?.rows ?? []).map(r => [r.day, r.total]));
  const axis = data.groups.axis;
  const rank = new Map(data.groups.list.map((g, i) => [g.key, i]));

  return (
    <div className="sk-news__days" data-testid="news-feed-days">
      {days.map(([day, events], i) => {
        const isOpen = open[day] ?? i < 2;
        const total = dayTotal.get(day);
        return (
          <section key={day} className="sk-news__day" data-testid={`news-day-${day}`} data-day={day}>
            <h3 className="sk-news__dayh">
              <button type="button" className="sk-news__daybtn" aria-expanded={isOpen}
                onClick={() => setOpen({ ...open, [day]: !isOpen })}>
                <span className="sk-news__chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span className="sk-news__dayname">{shortDay(day)}</span>
                <span className="sk-news__dayiso">{day}</span>
                {total && (
                  <span className="sk-news__daytotal" title={t('pair')}>
                    <span data-testid="news-day-total">{`${total.events} · ${total.elements}`}</span>
                  </span>
                )}
              </button>
            </h3>
            {isOpen && (axis === 'day'
              ? <ul className="sk-news__rows">{events.map(e => <Row key={e.key} e={e} lang={lang} tz={tz} hrefOf={hrefOf} onOpen={onOpen} />)}</ul>
              : <Buckets day={day} events={events} axis={axis} rank={rank} lang={lang} tz={tz} hrefOf={hrefOf} onOpen={onOpen} />)}
          </section>
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
        return (
          <div key={k} className="sk-news__bucket" data-testid={`news-bucket-${k}`}>
            <h4 className="sk-news__bh">
              <button type="button" className="sk-news__bbtn" aria-expanded={isOpen}
                onClick={() => setClosed({ ...closed, [k]: isOpen })}>
                <span className="sk-news__chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span>{newsGroupLabel(axis, k, lang)}</span>
              </button>
            </h4>
            {isOpen && (
              <ul className="sk-news__rows">
                {buckets.get(k)!.map(e => <Row key={`${day}|${k}|${e.key}`} e={e} lang={lang} tz={tz} hrefOf={hrefOf} onOpen={onOpen} />)}
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
      <span className="sk-news__tag" data-kind-tag={e.kind} data-tone={km.tone}
        style={{ '--pill-c': `var(--${km.tone})` } as CSSProperties}>
        <GameIcon slug={km.icon} size={12} />
        {kindLabel(e.kind, lang)}
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
        {e.future && <Pill tone="wrn" title={t('future.hint')}>{t('future')}</Pill>}
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
