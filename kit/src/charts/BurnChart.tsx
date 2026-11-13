// BurnChart — burnup/burndown спринта (SPRINT_UXR_S5_RECORD_TASKS/S5-03).
// Живёт СВЁРНУТЫМ под таблицей задач паспорта спринта (S5-02): главное в
// спринте — задачи за 2 клика, график — вторичен и не толкает таблицу вниз.
//
// Свёрнутый вид — одна кнопка-заголовок (aria-expanded/aria-controls) с
// итогом «остаток N из M». Честные состояния видны уже в свёрнутом заголовке:
// «не загрузилось» / «нет прав» / «задач нет» — не прячутся за раскрытием.
// Раскрытие и режим — управляемые (expanded/mode + колбэки): экран кладёт их
// в URL; без них компонент держит состояние сам.
//
// SVG тянется только по ширине (preserveAspectRatio=none + non-scaling-stroke),
// высота фиксирована — урок v1: пропорциональный график на широкой панели
// вырастал до ~400px.
import { useId, useState } from 'react';
import type { Completeness, LoadState } from '../states/loadState';
import { EmptyState, Forbidden, LoadError, Skeleton } from '../states/StateViews';
import { Truncated } from '../states/Truncated';
import { kitT, useKitLang } from '../i18n';
import { burnIdeal, burnSummary, type BurnForecastPoint, type BurnMode, type BurnPoint, type BurnVerdict } from './burn';

export interface BurnChartProps {
  /** Ряд из burnSeries (ok/partial). */
  points?: readonly BurnPoint[];
  /** Честное состояние загрузки срезов истории. */
  state: LoadState;
  error?: unknown;
  onRetry?: () => void;
  /** Полнота выдачи (для partial — плашка над графиком). */
  completeness?: Completeness;
  /** Раскрыт? undefined — неуправляемо (defaultExpanded). */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Режим; undefined — неуправляемо (defaultMode). */
  mode?: BurnMode;
  defaultMode?: BurnMode;
  onModeChange?: (mode: BurnMode) => void;
  className?: string;
  /**
   * K2-VIEW-TARGET «Цель к сроку». Срок объекта (дата): отметка по вертикали и план к
   * сроку — прямая от начала до объёма в день срока. `null` — приложение говорит, что
   * срока у объекта НЕТ (сказано словами); не передан — вид без срока, как раньше.
   */
  deadline?: string | null;
  /** Прогноз приложения: сколько будет закрыто к датам. kit его не считает (K-14). */
  forecast?: readonly BurnForecastPoint[];
  /** Вердикт приложения словами («не успеваем на 3 дня…») — виден и в свёрнутом заголовке. */
  verdict?: BurnVerdict;
  /**
   * Без своей шапки (PU-10): хозяин уже сказал сводку и вердикт строкой и сам решает, когда
   * график виден. Панель тогда открыта всегда; переключатель режима — над графиком.
   */
  headless?: boolean;
}

const W = 600;
const H = 96;
const PAD = 4;

interface Target { deadline?: string; forecast?: readonly BurnForecastPoint[] }

/** Правый край оси: последняя точка данных, срок или прогноз — что дальше. */
function lastDate(points: readonly BurnPoint[], t: Target): string {
  return [points[points.length - 1].date, t.deadline ?? '', ...(t.forecast ?? []).map(f => f.date)].sort().pop()!;
}

function Plot({ points, mode, label, target }: { points: readonly BurnPoint[]; mode: BurnMode; label: string; target: Target }) {
  const ms = points.map(p => Date.parse(p.date));
  const min = ms[0];
  const range = (Date.parse(lastDate(points, target)) - min) || 1;
  const scopeNow = points[points.length - 1].scope;
  const maxY = Math.max(...points.map(p => p.scope), 1);
  // Значение по режиму: burnup — закрыто, burndown — остаток от нынешнего объёма.
  const val = (done: number) => (mode === 'burnup' ? done : scopeNow - done);
  const x = (t: number) => (((t - min) / range) * W).toFixed(1);
  const y = (v: number) => (PAD + (H - 2 * PAD) * (1 - v / maxY)).toFixed(1);
  const xd = (d: string) => x(Date.parse(d));
  const line = (k: 'remaining' | 'scope' | 'done') => points.map((p, i) => `${x(ms[i])},${y(p[k])}`).join(' ');
  const ideal = burnIdeal(points);
  const first = points[0];
  const plan = target.deadline
    ? `${xd(first.date)},${y(val(first.done))} ${xd(target.deadline)},${y(val(scopeNow))}`
    : null;
  const fc = target.forecast?.length
    ? [{ date: points[points.length - 1].date, done: points[points.length - 1].done }, ...target.forecast]
      .map(f => `${xd(f.date)},${y(val(f.done))}`).join(' ')
    : null;
  return (
    <svg className="sk-burn__svg" width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {mode === 'burndown' ? (
        <>
          <polyline data-series="ideal" className="sk-burn__line sk-burn__line--ideal" points={ideal.map(p => `${x(Date.parse(p.date))},${y(p.value)}`).join(' ')} />
          <polyline data-series="remaining" className="sk-burn__line sk-burn__line--remaining" points={line('remaining')} />
        </>
      ) : (
        <>
          <polyline data-series="scope" className="sk-burn__line sk-burn__line--scope" points={line('scope')} />
          <polyline data-series="done" className="sk-burn__line sk-burn__line--done" points={line('done')} />
        </>
      )}
      {plan && <polyline data-series="plan" className="sk-burn__line sk-burn__line--plan" points={plan} />}
      {fc && <polyline data-series="forecast" className="sk-burn__line sk-burn__line--forecast" points={fc} />}
      {target.deadline && <line data-series="deadline" className="sk-burn__deadline" x1={xd(target.deadline)} x2={xd(target.deadline)} y1={0} y2={H} />}
    </svg>
  );
}

export function BurnChart({
  points, state, error, onRetry, completeness,
  expanded, defaultExpanded = false, onExpandedChange,
  mode, defaultMode = 'burndown', onModeChange, className,
  deadline, forecast, verdict, headless = false,
}: BurnChartProps) {
  const lang = useKitLang();
  const panelId = useId();
  const [ownOpen, setOwnOpen] = useState(defaultExpanded);
  const [ownMode, setOwnMode] = useState<BurnMode>(defaultMode);
  const open = headless || (expanded ?? ownOpen);
  const curMode = mode ?? ownMode;
  const hasData = (state === 'ok' || state === 'partial') && !!points;
  const sum = hasData ? burnSummary(points!) : null;

  const toggle = () => {
    const next = !open;
    if (expanded === undefined) setOwnOpen(next);
    onExpandedChange?.(next);
  };
  const pick = (m: BurnMode) => {
    if (mode === undefined) setOwnMode(m);
    onModeChange?.(m);
  };

  let badge: string;
  let tone: 'dim' | 'acc' | 'dng' | 'wrn';
  if (state === 'loading') { badge = kitT(lang, 'kit.burn.loading'); tone = 'dim'; }
  else if (state === 'error') { badge = kitT(lang, 'kit.burn.failed'); tone = 'dng'; }
  else if (state === 'forbidden') { badge = kitT(lang, 'kit.burn.forbidden'); tone = 'wrn'; }
  else if (!sum || sum.scope === 0) { badge = kitT(lang, 'kit.burn.empty'); tone = 'dim'; }
  else { badge = kitT(lang, 'kit.burn.summary', { remaining: sum.remaining, scope: sum.scope }); tone = state === 'partial' ? 'wrn' : 'acc'; }

  let body;
  if (state === 'loading') body = <Skeleton lines={2} />;
  else if (state === 'error') body = <LoadError compact error={error} onRetry={onRetry} />;
  else if (state === 'forbidden') body = <Forbidden compact />;
  else if (!sum || sum.scope === 0) body = <EmptyState compact title={kitT(lang, 'kit.burn.empty')} hint={kitT(lang, 'kit.burn.emptyHint')} />;
  else if (points!.length < 2) body = <p className="sk-burn__note">{kitT(lang, 'kit.burn.tooFew')}</p>;
  else {
    const label = kitT(lang, curMode === 'burndown' ? 'kit.burn.aria.burndown' : 'kit.burn.aria.burnup', {
      remaining: sum.remaining, done: sum.done, scope: sum.scope,
    });
    body = (
      <>
        <div className="sk-burn__legend">
          {curMode === 'burndown' ? (
            <>
              <span className="sk-burn__key sk-burn__key--remaining">{kitT(lang, 'kit.burn.remaining')} <b>{sum.remaining}</b></span>
              <span className="sk-burn__key sk-burn__key--ideal">{kitT(lang, 'kit.burn.ideal')}</span>
            </>
          ) : (
            <>
              <span className="sk-burn__key sk-burn__key--done">{kitT(lang, 'kit.burn.done')} <b>{sum.done}</b></span>
              <span className="sk-burn__key sk-burn__key--scope">{kitT(lang, 'kit.burn.scope')} <b>{sum.scope}</b></span>
            </>
          )}
          <span className="sk-burn__key">{kitT(lang, 'kit.burn.peak')} {sum.peak}</span>
          {deadline && <span className="sk-burn__key sk-burn__key--plan">{kitT(lang, 'kit.burn.plan')}</span>}
          {deadline && <span className="sk-burn__key sk-burn__key--deadline">{kitT(lang, 'kit.burn.deadline', { date: deadline })}</span>}
          {forecast?.length ? <span className="sk-burn__key sk-burn__key--forecast">{kitT(lang, 'kit.burn.forecast')}</span> : null}
        </div>
        {deadline === null && <p className="sk-burn__note" data-testid="kit-burn-no-deadline">{kitT(lang, 'kit.burn.noDeadline')}</p>}
        <Plot points={points!} mode={curMode} label={label} target={{ deadline: deadline ?? undefined, forecast }} />
        <div className="sk-burn__axis"><span>{sum.from}</span><span>{lastDate(points!, { deadline: deadline ?? undefined, forecast })}</span></div>
      </>
    );
  }

  const modes = (
    <div className="sk-burn__modes" role="group" aria-label={kitT(lang, 'kit.burn.mode')}>
      {(['burndown', 'burnup'] as const).map(m => (
        <button key={m} type="button" className="sk-burn__mode" aria-pressed={curMode === m} onClick={() => pick(m)}>
          {kitT(lang, m === 'burndown' ? 'kit.burn.mode.burndown' : 'kit.burn.mode.burnup')}
        </button>
      ))}
    </div>
  );

  return (
    <section className={['sk-burn', className].filter(Boolean).join(' ')} data-state={state}>
      {!headless && <div className="sk-burn__head">
        <button type="button" className="sk-burn__toggle" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
          <span className="sk-burn__chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="sk-burn__title">{kitT(lang, 'kit.burn.title')}</span>
          <span className={`sk-burn__badge sk-burn__badge--${tone}`}>{badge}</span>
          {verdict && hasData && <span className="sk-burn__verdict" data-testid="kit-burn-verdict" data-tone={verdict.tone}>{verdict.text}</span>}
        </button>
        {open && hasData && modes}
      </div>}
      {headless && hasData && modes}
      {open && (
        <div id={panelId} className="sk-burn__panel">
          {state === 'partial' && completeness && <Truncated completeness={completeness} />}
          {body}
        </div>
      )}
    </section>
  );
}
