// Вход @seidr/kit/charts-echarts — тела графиков kit на echarts 6 (D-2026-SEIDRKIT-ECHARTS-IN-KIT; владелица 21.11.2026:
// «включай echarts в kit», «или оставь рычаг svg echarts»). Импорт входа = регистрация рисовальщика 'echarts';
// выбирается рычагом <KitChartsProvider renderer="echarts"> или renderer у графика. Рамка, сводка, «Таблицей»,
// честные состояния — общие в kit; здесь только рисунок.
// Правила K4-CHARTS те же: цвета — токены темы (читаются при рисовании и перекрашиваются при смене палитры/режима),
// «нет данных ≠ 0» — разрыв линии и полоса, у столбиков ось от нуля. Подключаются только нужные части echarts.
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, MarkAreaComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { registerChartRenderer, type BarBodyProps, type LineBodyProps } from '../charts/renderer';
import { CHART_TONES } from '../charts/family';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, MarkAreaComponent, SVGRenderer]);

/** Значение токена темы (echarts сам var(--…) не понимает). */
function tok(name: string, fallback = 'currentColor'): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
const toneAt = (i: number) => tok(CHART_TONES[i % CHART_TONES.length]);

function useEchart(build: () => echarts.EChartsCoreOption, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'svg' });
    chart.setOption(build());
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => chart.resize()) : null;
    ro?.observe(el);
    // Смена палитры или режима kit меняет атрибуты корня — перекрашиваем.
    const mo = new MutationObserver(() => chart.setOption(build(), true));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] });
    return () => { ro?.disconnect(); mo.disconnect(); chart.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

const axisStyle = () => ({ axisLabel: { color: tok('--t3') }, axisLine: { lineStyle: { color: tok('--bd') } }, splitLine: { lineStyle: { color: tok('--bd') } } });

export function EchartsLine(p: LineBodyProps) {
  const ref = useEchart(() => {
    const gaps: [{ xAxis: number }, { xAxis: number }][] = [];
    const s0 = p.series[0]?.points ?? [];
    for (let i = 0; i < s0.length; i++) {
      if (s0[i].y !== null) continue;
      let j = i; while (j + 1 < s0.length && s0[j + 1].y === null) j++;
      gaps.push([{ xAxis: s0[Math.max(0, i - 1)].x }, { xAxis: s0[Math.min(s0.length - 1, j + 1)].x }]);
      i = j;
    }
    return {
      animation: false,
      textStyle: { color: tok('--t2'), fontFamily: tok('--font', 'sans-serif') },
      grid: { left: 40, right: 12, top: 16, bottom: 24 },
      tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? '—' : `${v}${p.unit ? ` ${p.unit}` : ''}`) },
      xAxis: { type: 'value', scale: true, ...axisStyle(), axisLabel: { color: tok('--t3'), formatter: (v: number) => p.xLabel(v) }, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, ...axisStyle() },
      series: p.series.map((s, i) => ({
        name: s.label, type: 'line', data: s.points.map((q) => [q.x, q.y]), showSymbol: false, connectNulls: false,
        lineStyle: { color: toneAt(i), type: s.dashed ? 'dashed' : 'solid', width: 2 }, itemStyle: { color: toneAt(i) },
        ...(i === 0 && gaps.length ? { markArea: { silent: true, itemStyle: { color: tok('--wrn'), opacity: 0.12 }, data: gaps } } : {}),
      })),
    };
  }, [JSON.stringify(p.series), p.unit]);
  return <div ref={ref} className="sk-chart__plot" style={{ height: p.height }} role="img" aria-label={p.title} />;
}

export function EchartsBar(p: BarBodyProps) {
  const ref = useEchart(() => ({
    animation: false,
    textStyle: { color: tok('--t2'), fontFamily: tok('--font', 'sans-serif') },
    grid: { left: 40, right: 12, top: 16, bottom: 32 },
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (v == null ? '—' : `${v}${p.unit ? ` ${p.unit}` : ''}`) },
    xAxis: { type: 'category', data: p.data.map((d) => d.category), ...axisStyle() },
    // Как у SVG-столбиков: ось от нуля, иначе высота врёт о доле.
    yAxis: { type: 'value', min: 0, ...axisStyle() },
    series: p.groups.map((g, i) => ({ name: g.label, type: 'bar', data: p.data.map((d) => d.values[g.key] ?? null), itemStyle: { color: toneAt(i) }, barMaxWidth: 28 })),
  }), [JSON.stringify(p.data), JSON.stringify(p.groups), p.unit]);
  return <div ref={ref} className="sk-chart__plot" style={{ height: p.height }} role="img" aria-label={p.title} />;
}

registerChartRenderer('echarts', { line: (p) => <EchartsLine {...p} />, bar: (p) => <EchartsBar {...p} /> });
