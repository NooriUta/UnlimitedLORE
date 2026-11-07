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
import { burnIdeal, burnSummary, type BurnMode, type BurnPoint } from './burn';

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
}

const W = 600;
const H = 96;
const PAD = 4;

function Plot({ points, mode, label }: { points: readonly BurnPoint[]; mode: BurnMode; label: string }) {
  const ms = points.map(p => Date.parse(p.date));
  const min = ms[0];
  const range = (ms[ms.length - 1] - min) || 1;
  const maxY = Math.max(...points.map(p => p.scope), 1);
  const x = (t: number) => (((t - min) / range) * W).toFixed(1);
  const y = (v: number) => (PAD + (H - 2 * PAD) * (1 - v / maxY)).toFixed(1);
  const line = (k: 'remaining' | 'scope' | 'done') => points.map((p, i) => `${x(ms[i])},${y(p[k])}`).join(' ');
  const ideal = burnIdeal(points);
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
    </svg>
  );
}

export function BurnChart({
  points, state, error, onRetry, completeness,
  expanded, defaultExpanded = false, onExpandedChange,
  mode, defaultMode = 'burndown', onModeChange, className,
}: BurnChartProps) {
  const lang = useKitLang();
  const panelId = useId();
  const [ownOpen, setOwnOpen] = useState(defaultExpanded);
  const [ownMode, setOwnMode] = useState<BurnMode>(defaultMode);
  const open = expanded ?? ownOpen;
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
        </div>
        <Plot points={points!} mode={curMode} label={label} />
        <div className="sk-burn__axis"><span>{sum.from}</span><span>{sum.to}</span></div>
      </>
    );
  }

  return (
    <section className={['sk-burn', className].filter(Boolean).join(' ')} data-state={state}>
      <div className="sk-burn__head">
        <button type="button" className="sk-burn__toggle" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
          <span className="sk-burn__chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="sk-burn__title">{kitT(lang, 'kit.burn.title')}</span>
          <span className={`sk-burn__badge sk-burn__badge--${tone}`}>{badge}</span>
        </button>
        {open && hasData && (
          <div className="sk-burn__modes" role="group" aria-label={kitT(lang, 'kit.burn.mode')}>
            {(['burndown', 'burnup'] as const).map(m => (
              <button key={m} type="button" className="sk-burn__mode" aria-pressed={curMode === m} onClick={() => pick(m)}>
                {kitT(lang, m === 'burndown' ? 'kit.burn.mode.burndown' : 'kit.burn.mode.burnup')}
              </button>
            ))}
          </div>
        )}
      </div>
      {open && (
        <div id={panelId} className="sk-burn__panel">
          {state === 'partial' && completeness && <Truncated completeness={completeness} />}
          {body}
        </div>
      )}
    </section>
  );
}
