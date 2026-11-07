// Блоки чисел экрана новостей v2 (S7A-02/03): метрики периода, разрез по оси,
// матрица «дни × проекты», сгорание своё/общее, знания. Каждое число — поле
// ответа сервера; клиент только раскладывает и подписывает. Метка Σ≠∪ —
// сравнение двух присланных чисел, а не пересчёт.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useKitLang } from '../i18n';
import type { KitLang } from '../i18n';
import { newsT, type NewsKey } from './i18n';
import {
  NEWS_MATRIX_COLS, axisLabel, drillLabel, groupDrillId, metricDrill, newsGroupLabel, pairText, pctText, shortDay,
  signTone, signed, type NewsDrillMetric, type NewsQuery,
} from './model';
import {
  NEWS_TASK_AXES, type NewsAxis, type NewsDelta, type NewsFilterAxis, type NewsPair, type NewsResponse,
  type NewsTaskAxis, type NewsUnmeasurable,
} from './types';

export type NewsSection = 'metrics' | 'groups' | 'matrix' | 'burn' | 'knowledge' | 'feed';

interface PanelsProps {
  data: NewsResponse;
  query: NewsQuery;
  update: (p: Partial<NewsQuery>) => void;
  sections: readonly NewsSection[];
  fixed: Set<string>;
}

type T = (k: NewsKey, vars?: Record<string, string | number>) => string;
/** Обработчик клика по числу или undefined, если сузить нечем (нет примеров). */
type Drill = (metric: string, total: number, examples: readonly string[]) => (() => void) | undefined;

const FILTERABLE = new Set<string>(['type', 'project', 'component', 'sprint', 'milestone', 'author', 'kind']);

export function NewsPanels({ data, query, update, sections, fixed }: PanelsProps) {
  const lang = useKitLang();
  const t: T = (k, vars) => newsT(lang, k, vars);
  /** Применить filter-дескриптор сервера (клик по группе — сузить ленту до неё). */
  const applyFilter = (f: Partial<Record<NewsAxis, string>>) => {
    const next = { ...query.filters };
    for (const [ax, v] of Object.entries(f)) {
      if (v !== undefined && FILTERABLE.has(ax) && !fixed.has(ax)) next[ax as NewsFilterAxis] = [v];
    }
    update({ filters: next });
  };
  /** Свёртка по типу/событию: клик ставит фильтр оси, клик по активному — снимает. */
  const toggleFilter = (ax: NewsFilterAxis, v: string) => {
    const next = { ...query.filters };
    if (next[ax]?.length === 1 && next[ax]![0] === v) delete next[ax]; else next[ax] = [v];
    update({ filters: next });
  };
  /** Клик по числу метрики (S7A-03): сузить ленту до элементов, из которых оно сложено. */
  const drill: Drill = (metric, total, examples) => {
    const d = metricDrill(metric, total, examples);
    return d ? () => update({ els: d.els, drill: d.drill }) : undefined;
  };
  return (
    <>
      {sections.includes('metrics') && (
        <Metrics data={data} t={t} lang={lang} query={query} fixed={fixed} onToggle={toggleFilter} drill={drill} />
      )}
      {sections.includes('groups') && <Groups data={data} t={t} lang={lang} onFilter={applyFilter} />}
      {sections.includes('matrix') && data.matrix && (
        <Matrix data={data} t={t} lang={lang} cols={query.matrix} onCols={n => update({ matrix: n })} onFilter={applyFilter} />
      )}
      {sections.includes('burn') && <Burn data={data} t={t} lang={lang} axis={query.group} onFilter={applyFilter} drill={drill} />}
      {sections.includes('knowledge') && <Knowledge data={data} t={t} />}
    </>
  );
}

// ── общие кирпичи ──

function SigmaUnion({ sum, total, t }: { sum: NewsPair; total: NewsPair; t: T }) {
  if (sum.events === total.events && sum.elements === total.elements) return null;
  return <span className="sk-news__su" title={t('sigmaUnion.hint')} data-testid="news-sigma-ne-union">{t('sigmaUnion')}</span>;
}

/**
 * Дельта к прошлому такому же периоду P⁻ (§7.5): знак, процент (только когда
 * сервер его прислал — при f(P⁻) ≥ 5) и в подсказке — границы P⁻ и «было».
 */
function Delta({ d, t, lang, prev }: { d?: NewsDelta; t: T; lang: KitLang; prev?: { from: string; to: string } }) {
  if (!d) return null;
  const title = prev
    ? t('delta.prevRange', { from: prev.from.slice(0, 10), to: prev.to.slice(0, 10), prev: d.previous })
    : t('delta.prev');
  return (
    <span className="sk-news__delta" title={title} data-tone={signTone(d.delta)} data-testid="news-delta">
      {signed(d.delta)}{d.pct !== null ? ` · ${pctText(d.pct, lang)}` : ''}
    </span>
  );
}

/** Число-кнопка: клик сужает ленту (S7A-03). Без обработчика — просто число. */
function Num({ value, label, onClick, testId, t }: {
  value: ReactNode; label: string; onClick?: () => void; testId?: string; t: T;
}) {
  if (!onClick) return <>{value}</>;
  return (
    <button type="button" className="sk-news__num" data-testid={testId} onClick={onClick}
      aria-label={t('drill.open', { metric: label, n: String(value) })} title={t('drill.hint')}>
      {value}
    </button>
  );
}

function Kpi({ id, label, value, tone, children, state }: {
  id: string; label: string; value: ReactNode; tone?: string; children?: ReactNode; state?: string;
}) {
  return (
    <div className="sk-news__kpi" data-testid={`news-kpi-${id}`} data-tone={tone} data-state={state}>
      <span className="sk-news__kv">{value}</span>
      <span className="sk-news__kl">{label}</span>
      {children}
    </div>
  );
}

function Unmeasurable({ id, label, u, t }: { id: string; label: string; u: NewsUnmeasurable; t: T }) {
  return (
    <Kpi id={id} label={label} value={t('unmeasurable')} tone="wrn" state="unmeasurable">
      <span className="sk-news__why">{u.reason}</span>
    </Kpi>
  );
}

function Panel({ id, title, children, extra }: { id: string; title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="sk-news__panel" data-testid={id} aria-label={title}>
      <div className="sk-news__ph">
        <h3 className="sk-news__pt">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

// ── метрики периода ──

function Metrics({ data, t, lang, query, fixed, onToggle, drill }: {
  data: NewsResponse; t: T; lang: KitLang; query: NewsQuery; fixed: Set<string>;
  onToggle: (ax: NewsFilterAxis, v: string) => void; drill: Drill;
}) {
  const m = data.metrics;
  const d = m.delta;
  const prev = d.previous;
  const tasks = m.tasks;
  const dl = (k: NewsDelta | undefined) => <Delta d={k} t={t} lang={lang} prev={prev} />;
  const num = (metric: NewsDrillMetric, value: number, examples: readonly string[], shown: ReactNode = value) => (
    <Num value={shown} label={drillLabel(metric, lang)} onClick={drill(metric, value, examples)} t={t} />
  );
  return (
    <Panel id="news-metrics" title={t('metrics')}>
      <div className="sk-news__kpis">
        <Kpi id="events" label={t('kpi.events')} value={pairText(m.counts.total)}>{dl(d.events)}{dl(d.elements)}</Kpi>
        {tasks.available ? (
          <>
            <Kpi id="burn" label={t('kpi.burn')} value={signed(tasks.all.burn)} tone={signTone(tasks.all.burn)}>
              {dl(d.burn)}
            </Kpi>
            <Kpi id="burn-dict" label={t('kpi.burnDict')} value={signed(tasks.all.burn_dict)} />
            <Kpi id="ship-correction" label={t('kpi.shipCorrection')} value={signed(tasks.all.ship_correction)} />
            <Kpi id="waiting" label={t('kpi.waiting')} tone="wrn"
              value={<>{`${tasks.all.waiting_t0} → `}{num('waiting', tasks.all.waiting_t1, tasks.all.examples.waiting)}</>}>
              {dl(d.waiting_t1)}
            </Kpi>
            <Kpi id="ship-unknown" label={t('kpi.shipUnknown')} value={tasks.all.ship_unknown} tone="wrn" />
            <Kpi id="shipped" label={t('kpi.shipped')} value={num('shipped', tasks.all.shipped, tasks.all.examples.shipped)}>
              {dl(d.shipped)}
            </Kpi>
            <Kpi id="closed" label={t('kpi.closed')} value={num('closed', tasks.all.closed, tasks.all.examples.closed)} />
            <Kpi id="median" label={t('kpi.median')} value={tasks.wait_median_days ?? '—'} />
            <Kpi id="react" label={t('kpi.react')}
              value={<>{`${tasks.all.react.events} · `}{num('react', tasks.all.react.elements, tasks.all.react.examples)}{
                tasks.all.react.rate !== null ? ` · ${pctText(Math.round(tasks.all.react.rate * 1000) / 10, lang)}` : ''}</>}>
              {dl(d.react_events)}
            </Kpi>
            <Kpi id="added" label={t('kpi.added')}
              value={<>{num('added', tasks.all.added, tasks.all.examples.added)}{` = ${tasks.all.added_new} + ${tasks.all.added_react}`}</>} />
          </>
        ) : (
          <Unmeasurable id="burn" label={t('kpi.burn')} u={tasks} t={t} />
        )}
        {m.agents.measurable
          ? <Kpi id="agents" label={t('kpi.agents')} value={`${m.agents.events.events} / ${m.agents.events.elements}`} />
          : <Unmeasurable id="agents" label={t('kpi.agents')} u={m.agents} t={t} />}
      </div>
      <Breakdown axis="type" pairs={m.counts.by_type} deltas={d.by_type} prev={prev}
        query={query} fixed={fixed} onToggle={onToggle} t={t} lang={lang} />
      <Breakdown axis="kind" pairs={m.counts.by_kind} query={query} fixed={fixed} onToggle={onToggle} t={t} lang={lang} />
    </Panel>
  );
}

/**
 * Свёртка периода по типу записи или событию: пара из counts.by_*, дельта —
 * из delta.by_type (по событиям сервер дельту не шлёт — и мы не рисуем).
 * Клик по свёртке — фильтр ленты по этой оси.
 */
function Breakdown({ axis, pairs, deltas, prev, query, fixed, onToggle, t, lang }: {
  axis: 'type' | 'kind'; pairs: Record<string, NewsPair>; deltas?: Record<string, NewsDelta>;
  prev?: { from: string; to: string }; query: NewsQuery; fixed: Set<string>;
  onToggle: (ax: NewsFilterAxis, v: string) => void; t: T; lang: KitLang;
}) {
  const keys = Object.keys(pairs);
  if (!keys.length) return null;
  const canFilter = !fixed.has(axis);
  return (
    <div className="sk-news__bd" role="group" aria-label={t(axis === 'type' ? 'breakdown.type' : 'breakdown.kind')}
      data-testid={`news-breakdown-${axis}`}>
      <span className="sk-list__label">{t(axis === 'type' ? 'breakdown.type' : 'breakdown.kind')}</span>
      {keys.map(k => {
        const label = `${newsGroupLabel(axis, k, lang)} · ${pairText(pairs[k])}`;
        const on = query.filters[axis]?.length === 1 && query.filters[axis]![0] === k;
        return (
          <span key={k} className="sk-news__bdi" data-testid={`news-bd-${axis}-${k}`}>
            {canFilter
              ? <button type="button" className="sk-news__chip" aria-pressed={on} onClick={() => onToggle(axis, k)}>{label}</button>
              : <span className="sk-news__chip">{label}</span>}
            {deltas?.[k] && <Delta d={deltas[k]} t={t} lang={lang} prev={prev} />}
          </span>
        );
      })}
    </div>
  );
}

// ── разрез по оси ──

function Groups({ data, t, lang, onFilter }: {
  data: NewsResponse; t: T; lang: KitLang; onFilter: (f: Partial<Record<NewsAxis, string>>) => void;
}) {
  const g = data.groups;
  const agents = data.metrics.agents.measurable;
  const canFilter = FILTERABLE.has(g.axis);
  return (
    <Panel id="news-groups" title={`${t('groups')}: ${axisLabel(g.axis, lang)}`}>
      <div className="sk-news__scroll">
        <table className="sk-news__table">
          <thead>
            <tr>
              <th scope="col">{axisLabel(g.axis, lang)}</th>
              <th scope="col" className="is-num">{t('pair')}</th>
              {g.element_level && <th scope="col" className="is-num">×N</th>}
              {agents && <th scope="col" className="is-num">{t('agents')}</th>}
            </tr>
          </thead>
          <tbody>
            {g.list.map(x => (
              <GroupRows key={x.key} x={x} axis={g.axis} lang={lang} t={t} agents={agents} elementLevel={g.element_level}
                onFilter={canFilter ? () => onFilter(x.filter) : undefined} />
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="news-groups-sum">
              <th scope="row">{t('groups.sum')}</th>
              <td className="is-num">{pairText(g.sum)}</td>
              {g.element_level && <td />}
              {agents && <td />}
            </tr>
            <tr data-testid="news-groups-total">
              <th scope="row">{t('groups.total')} <SigmaUnion sum={g.sum} total={g.total} t={t} /></th>
              <td className="is-num">{pairText(g.total)}</td>
              {g.element_level && <td />}
              {agents && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="sk-news__note" data-testid="news-groups-m">{t('groups.m', { m: g.multi_group_elements })}</p>
    </Panel>
  );
}

function GroupRows({ x, axis, lang, t, agents, elementLevel, onFilter }: {
  x: NewsResponse['groups']['list'][number]; axis: NewsAxis; lang: KitLang; t: T; agents: boolean; elementLevel: boolean;
  onFilter?: () => void;
}) {
  const label = newsGroupLabel(axis, x.key, lang);
  return (
    <>
      <tr data-testid={`news-group-${x.key}`}>
        <th scope="row">
          {onFilter
            ? <button type="button" className="sk-news__gbtn" title={x.key} onClick={onFilter}>{label}</button>
            : <span title={x.key}>{label}</span>}
        </th>
        <td className="is-num">{`${x.events} · ${x.elements}`}</td>
        {elementLevel && (
          <td className="is-num">
            {x.multi > 0 && <span className="sk-news__gn" title={t('multi.hint', { n: x.multi })}>{`×${x.multi}`}</span>}
          </td>
        )}
        {agents && <td className="is-num">{`${x.agent_events} · ${x.agent_elements}`}</td>}
      </tr>
      {x.sub && x.sub.groups.map(s => (
        <tr key={`${x.key}|${s.key}`} className="sk-news__subrow">
          <th scope="row">{`↳ ${newsGroupLabel(x.sub!.axis, s.key, lang)}`}</th>
          <td className="is-num">{`${s.events} · ${s.elements}`}</td>
          {elementLevel && <td className="is-num">{s.multi > 0 ? `×${s.multi}` : ''}</td>}
          {agents && <td />}
        </tr>
      ))}
    </>
  );
}

// ── матрица «дни × проекты» ──

function Matrix({ data, t, lang, cols, onCols, onFilter }: {
  data: NewsResponse; t: T; lang: KitLang; cols: number; onCols: (n: number) => void;
  onFilter: (f: Partial<Record<NewsAxis, string>>) => void;
}) {
  const mx = data.matrix!;
  const isOther = (c: string) => /^\(other:\d+\)$/.test(c);
  const extra = (
    <div role="radiogroup" aria-label={t('matrix.cols')} className="sk-list__views">
      {NEWS_MATRIX_COLS.map(n => (
        <button key={n} type="button" role="radio" aria-checked={cols === n}
          className={`sk-list__view${cols === n ? ' is-on' : ''}`} onClick={() => onCols(n)}>{String(n)}</button>
      ))}
    </div>
  );
  return (
    <Panel id="news-matrix" title={t('matrix')} extra={extra}>
      <div className="sk-news__scroll">
        <table className="sk-news__table sk-news__matrix">
          <thead>
            <tr>
              <th scope="col">{t('matrix.day')}</th>
              {mx.cols.map(c => <th key={c} scope="col" className="is-num" title={c}>{newsGroupLabel('project', c, lang)}</th>)}
              <th scope="col" className="is-num">{t('matrix.sumCells')}</th>
              <th scope="col" className="is-num">{t('matrix.total')}</th>
              <th scope="col" className="is-num">{t('matrix.m')}</th>
            </tr>
          </thead>
          <tbody>
            {mx.rows.map(r => (
              <tr key={r.day} data-testid={`news-matrix-row-${r.day}`}>
                <th scope="row" className="sk-news__mono">{r.day}</th>
                {r.cells.map(([ev, el], i) => {
                  const c = mx.cols[i];
                  const text = ev === 0 && el === 0 ? '·' : `${ev} · ${el}`;
                  return (
                    <td key={c} className="is-num">
                      {ev > 0 && !isOther(c)
                        ? <button type="button" className="sk-news__cell"
                            aria-label={t('matrix.cell', { day: shortDay(r.day), col: newsGroupLabel('project', c, lang), pair: `${ev} · ${el}` })}
                            onClick={() => onFilter({ project: c })}>{text}</button>
                        : text}
                    </td>
                  );
                })}
                <td className="is-num">{pairText(r.sum)} <SigmaUnion sum={r.sum} total={r.total} t={t} /></td>
                <td className="is-num sk-news__strong">{pairText(r.total)}</td>
                <td className="is-num">{r.multi || ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="news-matrix-cols">
              <th scope="row">{t('matrix.colTotal')}</th>
              {mx.col_totals.map(c => (
                <td key={c.col} className="is-num">{pairText(c.total)} <SigmaUnion sum={c.sum} total={c.total} t={t} /></td>
              ))}
              <td className="is-num">{pairText(mx.sum_rows)} <SigmaUnion sum={mx.sum_rows} total={mx.total} t={t} /></td>
              <td className="is-num sk-news__strong">{pairText(mx.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

// ── сгорание задач спринтов ──

function Burn({ data, t, lang, axis, onFilter, drill }: {
  data: NewsResponse; t: T; lang: KitLang; axis: NewsAxis; onFilter: (f: Partial<Record<NewsAxis, string>>) => void;
  drill: Drill;
}) {
  const tasks = data.metrics.tasks;
  const available = tasks.available ? NEWS_TASK_AXES.filter(a => tasks.by_axis[a]) : [];
  const initial: NewsTaskAxis = (available as readonly string[]).includes(axis) ? axis as NewsTaskAxis : (available[0] ?? 'project');
  const [ax, setAx] = useState<NewsTaskAxis | null>(null);
  const cur = ax && (available as readonly string[]).includes(ax) ? ax : initial;
  if (!tasks.available) {
    return (
      <Panel id="news-burn" title={t('burn')}>
        <p className="sk-news__banner" data-tone="wrn">{`${t('burn.unavailable')}: ${tasks.reason}`}</p>
      </Panel>
    );
  }
  const out = tasks.by_axis[cur];
  const extra = available.length > 1 && (
    <label className="sk-list__field">
      <span className="sk-list__label">{t('burn.axis')}</span>
      <select aria-label={t('burn.axis')} className="sk-list__select" value={cur} onChange={e => setAx(e.target.value as NewsTaskAxis)}>
        {available.map(a => <option key={a} value={a}>{axisLabel(a, lang)}</option>)}
      </select>
    </label>
  );
  const num = (n: number, tone?: string) => <td className="is-num" data-tone={tone ?? signTone(n)}>{signed(n)}</td>;
  return (
    <Panel id="news-burn" title={t('burn')} extra={extra}>
      {out && (
        <>
          <div className="sk-news__scroll">
            <table className="sk-news__table">
              <thead>
                <tr>
                  <th scope="col">{t('burn.col.group')}</th>
                  <th scope="col" className="is-num">{t('burn.col.total')}</th>
                  <th scope="col" className="is-num">{t('burn.col.own')}</th>
                  <th scope="col" className="is-num">{t('burn.col.shared')}</th>
                  <th scope="col" className="is-num">{t('burn.col.waiting')}</th>
                  <th scope="col" className="is-num">{t('burn.col.shipped')}</th>
                  <th scope="col" className="is-num">{t('burn.col.correction')}</th>
                </tr>
              </thead>
              <tbody>
                {out.groups.map(g => (
                  <tr key={g.key} data-testid={`news-burn-row-${g.key}`}>
                    <th scope="row">
                      <button type="button" className="sk-news__gbtn" title={g.key} onClick={() => onFilter(g.filter)}>
                        {newsGroupLabel(cur, g.key, lang)}
                      </button>
                    </th>
                    {num(g.total.burn)}
                    {num(g.own.burn)}
                    {num(g.shared.burn)}
                    <td className="is-num" data-tone="wrn">
                      <Num value={g.total.waiting_t1} t={t} testId="news-burn-drill-waiting"
                        label={drillLabel(groupDrillId('waiting', cur, g.key), lang)}
                        onClick={drill(groupDrillId('waiting', cur, g.key), g.total.waiting_t1, g.total.examples.waiting)} />
                    </td>
                    <td className="is-num">
                      <Num value={g.total.shipped} t={t} testId="news-burn-drill-shipped"
                        label={drillLabel(groupDrillId('shipped', cur, g.key), lang)}
                        onClick={drill(groupDrillId('shipped', cur, g.key), g.total.shipped, g.total.examples.shipped)} />
                    </td>
                    {num(g.total.ship_correction, 't2')}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sk-news__note" data-testid="news-burn-sigma">
            {`${t('burn.sigma')}: ${signed(out.burn_own_sum)} · ${signed(out.burn_shared_union)} · ${signed(out.burn_sigma)}`}
          </p>
        </>
      )}
      <h4 className="sk-news__pt">{t('burn.days')}</h4>
      <div className="sk-news__scroll">
        <table className="sk-news__table" data-testid="news-burn-days">
          <thead>
            <tr>
              <th scope="col">{t('burn.col.day')}</th>
              <th scope="col" className="is-num">{t('burn.col.open')}</th>
              <th scope="col" className="is-num">{t('burn.col.total')}</th>
              <th scope="col" className="is-num">{t('burn.col.burnDict')}</th>
              <th scope="col" className="is-num">{t('burn.col.waiting')}</th>
              <th scope="col" className="is-num">{t('burn.col.unknown')}</th>
              <th scope="col" className="is-num">{t('burn.col.shipped')}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.days.map(d => (
              <tr key={d.day_local}>
                <th scope="row" className="sk-news__mono">{d.day_local}</th>
                <td className="is-num">{`${d.open_start} → ${d.open_end}`}</td>
                {num(d.burn)}
                {num(d.burn_dict, 't2')}
                <td className="is-num" data-tone="wrn">{d.waiting_end}</td>
                <td className="is-num" data-tone="wrn">{d.ship_unknown_end}</td>
                <td className="is-num">{d.shipped || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ── знания ──

function Knowledge({ data, t }: { data: NewsResponse; t: T }) {
  const k = data.metrics.knowledge;
  const queue = (id: string, label: string, q: typeof k.adr) => (
    <Kpi id={id} label={label} value={q.q_t1} tone={q.exact ? undefined : 'wrn'}>
      <span className="sk-news__why">
        {q.exact
          ? `${t('knowledge.queueT0')}: ${q.q_t0 ?? '—'}`
          : `${t('knowledge.queueT0')}: ${q.q_t0_range?.[0] ?? '—'}…${q.q_t0_range?.[1] ?? '—'} — ${q.reason ?? ''}`}
      </span>
    </Kpi>
  );
  return (
    <Panel id="news-knowledge" title={t('knowledge')}>
      <div className="sk-news__kpis">
        {queue('adr-queue', t('knowledge.adrQueue'), k.adr)}
        {queue('dec-queue', t('knowledge.decQueue'), k.decision)}
        <Kpi id="adr-rev" label={t('knowledge.adrRev')} value={pairText(k.adr_revisions)} />
        <Kpi id="spec-versions" label={t('knowledge.specVersions')} value={pairText(k.spec_versions)} />
        {k.adr_reactivation && <Unmeasurable id="adr-react" label={t('kpi.react')} u={k.adr_reactivation} t={t} />}
      </div>
    </Panel>
  );
}
