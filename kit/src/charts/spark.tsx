// Мини-линия (Sparkline) — в семействе графиков kit (SPRINT_UXR_S15_KIT6; владелица 21.11.2026: «вставь в кит все»,
// пункт 6 страницы «Чего нет в kit»): рычаг svg | echarts действует и на неё. Пропуск (y = null) рвёт линию, а не тянет
// её к нулю; меньше двух точек — ничего не рисует. Плитки и карточки берут её отсюда.
import { useChartBodies, type ChartRenderer } from './renderer';

export interface SparkPoint { x: number; y: number | null }

/** Путь мини-линии: пропуск (y = null) начинает новый отрезок. Меньше двух точек — пустая строка. */
export function sparkPath(pts: readonly SparkPoint[], w: number, h: number): string {
  const vals = pts.filter((p): p is { x: number; y: number } => p.y !== null);
  if (vals.length < 2) return '';
  const x0 = pts[0].x, x1 = pts[pts.length - 1].x;
  const lo = Math.min(...vals.map((p) => p.y)), hi = Math.max(...vals.map((p) => p.y));
  const X = (x: number) => (x1 === x0 ? w / 2 : ((x - x0) / (x1 - x0)) * w);
  const Y = (y: number) => (hi === lo ? h / 2 : h - 1 - ((y - lo) / (hi - lo)) * (h - 2));
  let d = '', pen = false;
  for (const p of pts) {
    if (p.y === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)} `;
    pen = true;
  }
  return d.trim();
}

export function Sparkline({ points, height = 24, area = false, className, renderer }: { points: readonly SparkPoint[]; height?: number; area?: boolean; className?: string; /** Рычаг рисовальщика (главнее KitChartsProvider). */ renderer?: ChartRenderer }) {
  const { bodies } = useChartBodies(renderer);
  if (bodies?.spark) return <span className={['sk-spark', className].filter(Boolean).join(' ')} style={{ height, display: 'block' }}>{bodies.spark({ points, height, area })}</span>;
  const d = sparkPath(points, 100, height);
  return (
    <svg className={['sk-spark', className].filter(Boolean).join(' ')} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true" style={{ height }}>
      {d && area && <path className="sk-spark__area" d={`${d} L100,${height} L0,${height} Z`} />}
      {d && <path className="sk-spark__line" d={d} />}
    </svg>
  );
}

