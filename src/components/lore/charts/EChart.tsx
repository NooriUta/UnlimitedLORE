// ECharts в LORE: только нужные части (tree-shaking) — столбцы, линии, сетка,
// подсказка, легенда, SVG-рендер (как в Völva: чётко на любом масштабе). Тема — из токенов LORE: цвета разрешаются через
// вычисленный стиль, потому что canvas не понимает var(--…) и color-mix().
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, SVGRenderer]);

/** CSS-цвет (в т.ч. var(--x) и color-mix) → то, что понимает canvas. */
export function resolveCssColor(css: string): string {
  if (typeof document === 'undefined') return css;
  const el = document.createElement('span');
  el.style.color = css;
  el.style.display = 'none';
  document.body.appendChild(el);
  const out = getComputedStyle(el).color || css;
  el.remove();
  return out;
}

interface Props {
  option: any;
  height?: number;
  ariaLabel: string;
}

export default function EChart({ option, height = 140, ariaLabel }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = echarts.init(hostRef.current, undefined, { renderer: 'svg' });
    chartRef.current = chart;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => chart.resize()) : null;
    ro?.observe(hostRef.current);
    return () => { ro?.disconnect(); chart.dispose(); chartRef.current = null; };
  }, []);

  useEffect(() => { chartRef.current?.setOption(option, true); }, [option]);

  return <div ref={hostRef} role="img" aria-label={ariaLabel} style={{ width: '100%', height }} />;
}
