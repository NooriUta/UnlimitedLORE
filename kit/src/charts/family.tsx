// Графики одним семейством (SPRINT_UXR_S13_KIT4/K4-CHARTS).
//
// Повод — разбор kit по продуктам 11.11.2026 (принят владелицей): каждый продукт рисовал графики
// руками (BRAGI — столбики div-ами, MUNINN — Парето, дрейф, матрица, MIDGARD — телеметрия).
// Прототип k4-charts.html утверждён 14.11.2026 («все» — четыре рекомендации):
//   1) тепловая матрица — отдельный вид heat;
//   2) первый потребитель — аналитика BRAGI;
//   3) пропуск в линии — разрыв и полоса «нет данных», а не ноль;
//   4) ось Y у столбиков всегда от нуля, у линий и точек — по данным.
//
// Общие правила одним местом:
//   • ось — один расчёт делений (niceTicks), подписи только в пределах, которых данные достигают;
//   • «нет данных» ≠ 0; «не загрузилось» — причина и «Повторить»; «показана часть» — с числом;
//     «пусто» — словами, не пустая рамка;
//   • цвета — только токены темы (палитра категорий kit);
//   • доступность — «Таблицей» (те же данные строками) и сводка «макс / мин / последнее» текстом;
//   • телефон — высота фиксирована, ширина по контейнеру (урок BurnChart: пропорциональный
//     график вырастал до 400 px).
// Граница K-14: что считать сериями и откуда данные — приложение; kit только рисует.
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { kitLocale, kitT, useKitLang, type KitLang } from '../i18n';
import { EmptyState, LoadError, Skeleton } from '../states/StateViews';
import { useChartBodies, type ChartRenderer } from './renderer';

/** Палитра категорий kit — только токены. */
export const CHART_TONES = ['--acc', '--inf', '--suc', '--wrn', '--dng', '--t2'] as const;
const tone = (i: number) => `var(${CHART_TONES[i % CHART_TONES.length]})`;

/** Ширина до первого замера (и в среде без ResizeObserver). */
const W0 = 640;

/**
 * Ширина рисунка — ширина контейнера, а не растяжение (препрод 16.11: с preserveAspectRatio="none"
 * в узкой колонке текст делений сжимался и точки вытягивались). viewBox совпадает с пикселями.
 */
// Ширина площадки — по контейнеру. Ссылка-функция, а не useRef + эффект при монтировании: пока график
// «Загрузка…», площадки нет, и наблюдатель, подключённый один раз, её так и не видел — график оставался
// шириной по умолчанию и растягивался (препрод 16.11, «Аналитика»).
type PlotRef = (el: HTMLDivElement | null) => void;
function useChartWidth(): [PlotRef, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(W0);
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const cw = Math.round(entries[0]?.contentRect.width ?? 0);
      if (cw > 0) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}
const H = 200;
const PAD = { l: 36, r: 12, t: 10, b: 24 };

function niceStep(raw: number): number {
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

/** Круглые деления (1·2·5×10ⁿ) в пределах [min, max]: подписываем только то, чего данные достигают. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const step = niceStep((max - min) / count);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const num = (v: number) => String(Math.round(v * 100) / 100);

/** Общие части пропсов: заголовок, источник, честные состояния. */
export interface ChartCommon {
  title: string;
  /** Откуда данные — подпись под заголовком («MUNINN · bench drift»). */
  source?: string;
  unit?: string;
  loading?: boolean;
  /** Не загрузилось — причина словами. */
  error?: string;
  onRetry?: () => void;
  /** Показана часть: сколько показано и сколько всего. */
  shown?: number;
  total?: number;
  className?: string;
  /** Рычаг рисовальщика для этого графика (главнее KitChartsProvider): 'svg' | 'echarts'. */
  renderer?: ChartRenderer;
}

interface FrameProps extends ChartCommon {
  kind: 'line' | 'scatter' | 'bar' | 'heat';
  empty: boolean;
  summary?: ReactNode;
  legend?: { label: string; color: string; dashed?: boolean }[];
  notes?: string[];
  table: () => ReactNode;
  children: ReactNode;
}

function ChartFrame(p: FrameProps) {
  const lang = useKitLang();
  const [asTable, setAsTable] = useState(false);
  const t = (k: Parameters<typeof kitT>[1], v?: Record<string, string | number>) => kitT(lang, k, v);
  let body: ReactNode;
  if (p.loading) body = <Skeleton lines={4} />;
  else if (p.error !== undefined) body = <LoadError compact error={p.error} onRetry={p.onRetry} />;
  else if (p.empty) body = <EmptyState compact title={t('kit.chart.empty')} />;
  else body = (
    <>
      {p.summary && <p className="sk-chart__sum" data-testid="kit-chart-summary">{p.summary}</p>}
      {asTable ? p.table() : p.children}
      {p.legend && p.legend.length > 0 && (
        <ul className="sk-chart__legend">
          {p.legend.map(l => (
            <li key={l.label} className="sk-chart__key"><span className="sk-chart__swatch" data-dashed={l.dashed ? '' : undefined} style={{ background: l.color }} aria-hidden="true" />{l.label}</li>
          ))}
        </ul>
      )}
      {p.notes?.map(n => <p key={n} className="sk-chart__note" role="note">{n}</p>)}
      <button type="button" className="sk-btn sk-chart__tbl" aria-pressed={asTable} onClick={() => setAsTable(v => !v)}>
        {t(asTable ? 'kit.chart.asChart' : 'kit.chart.asTable')}
      </button>
    </>
  );
  return (
    <section className={['sk-chart', p.className].filter(Boolean).join(' ')} data-testid="kit-chart" data-kind={p.kind} aria-label={p.title}>
      <header className="sk-chart__head">
        <h3 className="sk-chart__title">{p.title}</h3>
        <span className="sk-chart__kind">{p.kind}</span>
        {p.source && <p className="sk-chart__src">{p.source}</p>}
      </header>
      {typeof p.shown === 'number' && typeof p.total === 'number' && p.total > p.shown && (
        <p className="sk-chart__note sk-chart__note--warn" role="status">{t('kit.chart.part', { shown: p.shown, total: p.total })}</p>
      )}
      {body}
    </section>
  );
}

function summaryText(lang: KitLang, values: number[], last: number | undefined, unit?: string): ReactNode {
  if (values.length === 0) return null;
  const u = unit ? ` ${unit}` : '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  return (
    <>
      {kitT(lang, 'kit.chart.max')} <b>{num(max)}{u}</b> · {kitT(lang, 'kit.chart.min')} <b>{num(min)}{u}</b>
      {last !== undefined && <> · {kitT(lang, 'kit.chart.last')} <b>{num(last)}{u}</b></>}
    </>
  );
}

function YAxis({ ticks, y, w: W }: { ticks: number[]; y: (v: number) => number; w: number }) {
  return (
    <g className="sk-chart__axis">
      {ticks.map(v => (
        <g key={v} data-tick={num(v)}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="sk-chart__grid" />
          <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" className="sk-chart__tick">{num(v)}</text>
        </g>
      ))}
    </g>
  );
}

function scale(d0: number, d1: number, r0: number, r1: number) {
  return (v: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));
}

function Svg({ label, plot, w, children }: { label: string; plot: PlotRef; w: number; children: ReactNode }) {
  return <div ref={plot} className="sk-chart__plot"><svg className="sk-chart__svg" viewBox={`0 0 ${w} ${H}`} width="100%" role="img" aria-label={label} height={H}>{children}</svg></div>;
}

// ── line ───────────────────────────────────────────────────────────────────
export interface LineSeries { key: string; label: string; points: { x: number; y: number | null }[]; dashed?: boolean }
export interface LineChartProps extends ChartCommon { series: LineSeries[]; /** Подпись момента x (по умолчанию — дата локалью kit). */ xLabel?: (x: number) => string }

export function LineChart(p: LineChartProps) {
  const [plot, W] = useChartWidth();
  const lang = useKitLang();
  const fmt = p.xLabel ?? ((x: number) => new Date(x).toLocaleDateString(lang === 'en' ? 'en-GB' : kitLocale(lang), { day: '2-digit', month: '2-digit' }));
  const all = p.series.flatMap(s => s.points);
  const ys = all.map(q => q.y).filter((v): v is number => v !== null);
  const xs = all.map(q => q.x);
  const gaps = all.filter(q => q.y === null).length;
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const ticks = ys.length ? niceTicks(y0, y1) : [];
  const yLo = Math.min(y0, ...ticks), yHi = Math.max(y1, ...ticks);
  const x = scale(Math.min(...xs), Math.max(...xs), PAD.l, W - PAD.r);
  const y = scale(yLo, yHi, H - PAD.b, PAD.t);
  const first = p.series[0]?.points.filter(q => q.y !== null);
  const last = first?.length ? first[first.length - 1].y! : undefined;
  const xTicks = [...new Set(xs)].sort((a, b) => a - b);
  const step = Math.max(1, Math.ceil(xTicks.length / 5));
  const { bodies, missing } = useChartBodies(p.renderer);
  const notes = [...(gaps ? [kitT(lang, 'kit.chart.gaps', { n: gaps })] : []), ...(missing ? [kitT(lang, 'kit.chart.rendererMissing', { name: missing })] : [])];
  return (
    <ChartFrame {...p} kind="line" empty={ys.length === 0}
      summary={summaryText(lang, ys, last, p.unit)}
      legend={p.series.map((s, i) => ({ label: s.label, color: tone(i), dashed: s.dashed }))}
      notes={notes.length ? notes : undefined}
      table={() => (
        <table className="sk-chart__table">
          <thead><tr><th>{kitT(lang, 'kit.chart.when')}</th>{p.series.map(s => <th key={s.key}>{s.label}</th>)}</tr></thead>
          <tbody>{xTicks.map(xv => (
            <tr key={xv}><td>{fmt(xv)}</td>{p.series.map(s => {
              const v = s.points.find(q => q.x === xv)?.y;
              return <td key={s.key}>{v === null || v === undefined ? kitT(lang, 'kit.chart.noData') : num(v)}</td>;
            })}</tr>
          ))}</tbody>
        </table>
      )}>
      {bodies ? bodies.line({ title: p.title, unit: p.unit, series: p.series, xLabel: fmt, height: H }) : <Svg label={p.title} plot={plot} w={W}>
        <YAxis ticks={ticks} y={y} w={W} />
        {p.series.flatMap(s => s.points.map((q, i) => {
          if (q.y !== null) return null;
          const prev = s.points[i - 1]?.x ?? q.x;
          const next = s.points[i + 1]?.x ?? q.x;
          return <rect key={`${s.key}:${q.x}`} data-gap="" className="sk-chart__gap" x={x(prev)} width={Math.max(2, x(next) - x(prev))} y={PAD.t} height={H - PAD.t - PAD.b} />;
        }))}
        {p.series.map((s, i) => {
          let d = '';
          let pen = false;
          for (const q of s.points) {
            if (q.y === null) { pen = false; continue; }
            d += `${pen ? 'L' : 'M'}${x(q.x).toFixed(1)},${y(q.y).toFixed(1)}`;
            pen = true;
          }
          return <path key={s.key} data-series={s.key} d={d} fill="none" stroke={tone(i)} strokeWidth={2} strokeDasharray={s.dashed ? '6 4' : undefined} vectorEffect="non-scaling-stroke" />;
        })}
        {xTicks.filter((_, i) => i % step === 0).map(xv => (
          <text key={xv} x={x(xv)} y={H - 6} textAnchor="middle" className="sk-chart__tick">{fmt(xv)}</text>
        ))}
      </Svg>}
    </ChartFrame>
  );
}

// ── scatter ────────────────────────────────────────────────────────────────
export interface ScatterPoint { x: number; y: number; label?: string; group?: string }
/** Больше точек — подписи у точек не рисуются (имена — в таблице). */
export const SCATTER_LABELS_MAX = 20;

export interface ScatterChartProps extends ChartCommon {
  points: ScatterPoint[];
  xTitle?: string;
  groups?: { key: string; label: string }[];
  /** Подпись x (ось времени): в таблице и тремя делениями под рисунком — вместо сырого числа. */
  xLabel?: (x: number) => string;
}

export function ScatterChart(p: ScatterChartProps) {
  const [plot, W] = useChartWidth();
  const lang = useKitLang();
  const xs = p.points.map(q => q.x), ys = p.points.map(q => q.y);
  const yt = ys.length ? niceTicks(Math.min(...ys), Math.max(...ys)) : [];
  const x = scale(Math.min(...xs), Math.max(...xs), PAD.l + 8, W - PAD.r - 8);
  const y = scale(Math.min(...ys, ...yt), Math.max(...ys, ...yt), H - PAD.b, PAD.t + 6);
  const gi = (g?: string) => Math.max(0, (p.groups ?? []).findIndex(x2 => x2.key === g));
  // Подписи у точек — пока точек немного: на сотнях они сливаются в кашу и вылезают за карточку
  // (препрод 16.11, Lead time — 1500 задач). Имена остаются в «Таблицей».
  const showLabels = p.points.length <= SCATTER_LABELS_MAX;
  return (
    <ChartFrame {...p} kind="scatter" empty={p.points.length === 0}
      summary={summaryText(lang, ys, undefined, p.unit)}
      legend={(p.groups ?? []).map((g, i) => ({ label: g.label, color: tone(i) }))}
      table={() => (
        <table className="sk-chart__table">
          <thead><tr><th>{kitT(lang, 'kit.chart.point')}</th><th>{p.xTitle ?? 'x'}</th><th>y</th></tr></thead>
          <tbody>{p.points.map((q, i) => <tr key={i}><td>{q.label ?? i + 1}</td><td>{p.xLabel ? p.xLabel(q.x) : num(q.x)}</td><td>{num(q.y)}</td></tr>)}</tbody>
        </table>
      )}>
      <Svg label={p.title} plot={plot} w={W}>
        <YAxis ticks={yt} y={y} w={W} />
        {p.points.map((q, i) => (
          <g key={i} data-point="">
            <circle cx={x(q.x)} cy={y(q.y)} r={4} fill={tone(gi(q.group))} />
            {showLabels && q.label && (x(q.x) > W * 0.75
              ? <text x={x(q.x) - 6} y={y(q.y) - 6} textAnchor="end" className="sk-chart__lbl">{q.label}</text>
              : <text x={x(q.x) + 6} y={y(q.y) - 6} textAnchor="start" className="sk-chart__lbl">{q.label}</text>)}
          </g>
        ))}
        {p.xLabel && xs.length > 0 && [...new Set([Math.min(...xs), (Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...xs)])].map((xv, i, all) => (
          <text key={xv} data-xtick="" x={x(xv)} y={H - 6} textAnchor={all.length === 1 ? 'middle' : i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'middle'} className="sk-chart__tick">{p.xLabel!(xv)}</text>
        ))}
        {p.xTitle && !p.xLabel && <text x={W - PAD.r} y={H - 6} textAnchor="end" className="sk-chart__tick">{p.xTitle} →</text>}
      </Svg>
    </ChartFrame>
  );
}

// ── bar ────────────────────────────────────────────────────────────────────
export interface BarChartProps extends ChartCommon {
  groups: { key: string; label: string }[];
  data: { category: string; values: Record<string, number | null> }[];
}

export function BarChart(p: BarChartProps) {
  const [plot, W] = useChartWidth();
  const lang = useKitLang();
  const vals = p.data.flatMap(d => p.groups.map(g => d.values[g.key])).filter((v): v is number => typeof v === 'number');
  // Рекомендация 4: у столбиков ось Y всегда от нуля — иначе высота врёт о доле.
  const ticks = vals.length ? niceTicks(0, Math.max(...vals)) : [];
  const top = Math.max(...vals, ...ticks, 1);
  const y = scale(0, top, H - PAD.b, PAD.t);
  const band = (W - PAD.l - PAD.r) / Math.max(1, p.data.length);
  const bw = Math.min(28, (band * 0.7) / Math.max(1, p.groups.length));
  const nulls = p.data.flatMap(d => p.groups.map(g => d.values[g.key])).filter(v => v === null || v === undefined).length;
  // Подписи категорий не теснее ~40 px (графики 19.11.2026: 30 дней на телефоне слипались в кашу) —
  // через одну-две, как у линии; все категории — в «Таблицей».
  const every = Math.max(1, Math.ceil(p.data.length / Math.max(1, Math.floor((W - PAD.l - PAD.r) / 40))));
  // Подпись не шире своей полосы (≈7 px на знак): длиннее — многоточие, полное имя — в <title> и «Таблицей».
  const fit = Math.max(3, Math.floor((band * every) / 7));
  const { bodies, missing } = useChartBodies(p.renderer);
  const notes = [...(nulls ? [kitT(lang, 'kit.chart.gaps', { n: nulls })] : []), ...(missing ? [kitT(lang, 'kit.chart.rendererMissing', { name: missing })] : [])];
  return (
    <ChartFrame {...p} kind="bar" empty={p.data.length === 0 || vals.length === 0}
      summary={summaryText(lang, vals, undefined, p.unit)}
      legend={p.groups.map((g, i) => ({ label: g.label, color: tone(i) }))}
      notes={notes.length ? notes : undefined}
      table={() => (
        <table className="sk-chart__table">
          <thead><tr><th>{kitT(lang, 'kit.chart.category')}</th>{p.groups.map(g => <th key={g.key}>{g.label}</th>)}</tr></thead>
          <tbody>{p.data.map(d => (
            <tr key={d.category}><td>{d.category}</td>{p.groups.map(g => {
              const v = d.values[g.key];
              return <td key={g.key}>{typeof v === 'number' ? num(v) : kitT(lang, 'kit.chart.noData')}</td>;
            })}</tr>
          ))}</tbody>
        </table>
      )}>
      {bodies ? bodies.bar({ title: p.title, unit: p.unit, groups: p.groups, data: p.data, height: H }) : <Svg label={p.title} plot={plot} w={W}>
        <YAxis ticks={ticks} y={y} w={W} />
        {p.data.map((d, ci) => {
          const x0 = PAD.l + ci * band + (band - bw * p.groups.length) / 2;
          return (
            <g key={d.category}>
              {p.groups.map((g, gi) => {
                const v = d.values[g.key];
                if (typeof v !== 'number') return null;
                return <rect key={g.key} data-bar="" x={x0 + gi * bw} width={bw - 2} y={y(v)} height={Math.max(0, y(0) - y(v))} fill={tone(gi)} />;
              })}
              {ci % every === 0 && (
                <text data-cat="" x={PAD.l + ci * band + band / 2} y={H - 6} textAnchor="middle" className="sk-chart__tick">
                  {d.category.length > fit ? <><title>{d.category}</title>{d.category.slice(0, fit - 1).trimEnd()}…</> : d.category}
                </text>
              )}
            </g>
          );
        })}
      </Svg>}
    </ChartFrame>
  );
}

// ── heat ───────────────────────────────────────────────────────────────────
export interface HeatChartProps extends ChartCommon { rows: string[]; cols: string[]; values: (number | null)[][] }

export function HeatChart(p: HeatChartProps) {
  const lang = useKitLang();
  const vals = p.values.flat().filter((v): v is number => typeof v === 'number');
  const lo = Math.min(...vals), hi = Math.max(...vals);
  // Насыщенность — доля акцента в клетке (токен --acc, смешанный с фоном), а не сырой цвет.
  const mix = (v: number) => `color-mix(in srgb, var(--acc) ${Math.round(15 + (hi === lo ? 1 : (v - lo) / (hi - lo)) * 70)}%, var(--bg2))`;
  const grid = (
    <div className="sk-chart__scroll">
      <table className="sk-chart__heat">
        <thead><tr><td />{p.cols.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{p.rows.map((r, ri) => (
          <tr key={r}><th scope="row">{r}</th>{p.cols.map((c, ci) => {
            const v = p.values[ri]?.[ci];
            const has = typeof v === 'number';
            return <td key={c} data-cell="" style={has ? { background: mix(v) } : undefined} data-none={has ? undefined : ''}>{has ? num(v) : '—'}</td>;
          })}</tr>
        ))}</tbody>
      </table>
    </div>
  );
  return (
    <ChartFrame {...p} kind="heat" empty={vals.length === 0}
      summary={summaryText(lang, vals, undefined, p.unit)}
      table={() => grid}>
      {grid}
    </ChartFrame>
  );
}
