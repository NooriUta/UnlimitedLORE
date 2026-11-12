// Мини-сгорание в строку таблицы (K2-VIEW-TARGET): закрыто и объём, без осей.
// Строка вехи — спринт с полосой и мини-графиком. Меньше двух точек — словами,
// а не плоской линией, которая выглядела бы «ничего не происходит».
import { kitT, useKitLang } from '../i18n';
import { burnSummary, type BurnPoint } from './burn';

export interface BurnSparkProps { points: readonly BurnPoint[]; className?: string }

const W = 80;
const H = 18;

export function BurnSpark({ points, className }: BurnSparkProps) {
  const lang = useKitLang();
  const cls = ['sk-burn-spark', className].filter(Boolean).join(' ');
  if (points.length < 2) return <span className={`${cls} sk-burn-spark--few`}>{kitT(lang, 'kit.burn.spark.few')}</span>;
  const sum = burnSummary(points)!;
  const ms = points.map(p => Date.parse(p.date));
  const min = ms[0];
  const range = (ms[ms.length - 1] - min) || 1;
  const maxY = Math.max(...points.map(p => p.scope), 1);
  const line = (k: 'scope' | 'done') => points
    .map((p, i) => `${(((ms[i] - min) / range) * W).toFixed(1)},${(1 + (H - 2) * (1 - p[k] / maxY)).toFixed(1)}`).join(' ');
  return (
    <svg className={cls} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={kitT(lang, 'kit.burn.aria.burnup', { done: sum.done, scope: sum.scope, remaining: sum.remaining })}>
      <polyline data-series="scope" className="sk-burn__line sk-burn__line--scope" points={line('scope')} />
      <polyline data-series="done" className="sk-burn__line sk-burn__line--done" points={line('done')} />
    </svg>
  );
}
