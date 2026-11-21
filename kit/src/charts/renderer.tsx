// Рычаг рисовальщика графиков svg | echarts (D-2026-SEIDRKIT-ECHARTS-IN-KIT; владелица 21.11.2026).
// Основной kit про echarts не знает: тело графика на echarts регистрирует отдельный вход пакета
// `@seidr/kit/charts-echarts` (импорт = регистрация). Приложение без echarts его не подключает и весом не платит.
// Выбор: <KitChartsProvider renderer="echarts"> на всё приложение или renderer у одного графика (главнее).
// Выбран echarts, а вход не подключён — kit рисует своим SVG и говорит об этом строкой, а не пустым местом.
import { createContext, useContext, type ReactNode } from 'react';

export type ChartRenderer = 'svg' | 'echarts';

/** Что получает тело графика: те же данные, что и SVG-рисовальщик. */
export interface LineBodyProps { title: string; unit?: string; series: { key: string; label: string; points: { x: number; y: number | null }[]; dashed?: boolean }[]; xLabel: (x: number) => string; height: number }
export interface BarBodyProps { title: string; unit?: string; groups: { key: string; label: string }[]; data: { category: string; values: Record<string, number | null> }[]; height: number }
export interface SparkBodyProps { points: readonly { x: number; y: number | null }[]; height: number; area: boolean }
export interface ChartBodies { line: (p: LineBodyProps) => ReactNode; bar: (p: BarBodyProps) => ReactNode; /** Мини-линия; нет — Sparkline рисует своим SVG. */ spark?: (p: SparkBodyProps) => ReactNode }

const REGISTRY: Partial<Record<Exclude<ChartRenderer, 'svg'>, ChartBodies>> = {};

export function registerChartRenderer(name: Exclude<ChartRenderer, 'svg'>, bodies: ChartBodies): void { REGISTRY[name] = bodies; }
export function unregisterChartRenderer(name: Exclude<ChartRenderer, 'svg'>): void { delete REGISTRY[name]; }

const Ctx = createContext<ChartRenderer>('svg');

export function KitChartsProvider({ renderer, children }: { renderer: ChartRenderer; children: ReactNode }) {
  return <Ctx.Provider value={renderer}>{children}</Ctx.Provider>;
}

/** Какой рисовальщик у графика: свой выбор главнее общего; не подключённый — { bodies: null, missing }. */
export function useChartBodies(own?: ChartRenderer): { bodies: ChartBodies | null; missing: ChartRenderer | null } {
  const shared = useContext(Ctx);
  const r = own ?? shared;
  if (r === 'svg') return { bodies: null, missing: null };
  const b = REGISTRY[r];
  return b ? { bodies: b, missing: null } : { bodies: null, missing: r };
}
