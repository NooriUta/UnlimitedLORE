/**
 * Option ECharts для графика скорости по ISO-неделям — тот же смысл, что у
 * прежнего SVG в «Аналитике»: столбик = неделя, текущая подсвечена; со стопками —
 * по серии на проект. Чистая функция: цвета приходят уже разрешёнными (canvas не
 * понимает var(--…) и color-mix), чтобы её можно было проверить тестом.
 */
export interface VelocityWeek { key: string; label: string; count: number; isCurrent: boolean }
export interface VelocityStack { label: string; color: string; counts: Record<string, number> }
export interface VelocityPalette { accent: string; muted: string; text: string; grid: string; tooltipBg?: string; tooltipText?: string }
export function velocityOption(weeks: VelocityWeek[], stacks: VelocityStack[] | undefined, resolve: (css: string) => string, pal: VelocityPalette): any {
  const labels = weeks.map(w => w.label);
  const base = {
    animation: false,
    grid: { left: 28, right: 8, top: 18, bottom: 22, containLabel: false },
    textStyle: { fontFamily: 'Manrope, sans-serif' },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: pal.tooltipBg, borderColor: pal.grid, textStyle: { color: pal.tooltipText, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 } },
    xAxis: { type: 'category', data: labels, axisLabel: { color: pal.text, fontSize: 9 }, axisLine: { lineStyle: { color: pal.grid } }, axisTick: { show: false } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: pal.text, fontSize: 9 }, splitLine: { lineStyle: { color: pal.grid } } },
  };
  if (!stacks || stacks.length === 0) {
    return {
      ...base,
      legend: { show: false },
      series: [{
        type: 'bar',
        name: 'velocity',
        barMaxWidth: 28,
        // Недели без закрытий приходят нулём, а не выпадают: пропуск завышал бы
        // среднюю скорость на глаз (то же правило, что в разборе 06.11).
        data: weeks.map(w => ({ value: w.count, itemStyle: { color: w.isCurrent ? pal.accent : pal.muted } })),
        label: { show: true, position: 'top', color: pal.text, fontSize: 9, formatter: (p: { value: number }) => (p.value > 0 ? String(p.value) : '') },
      }],
    };
  }
  return {
    ...base,
    legend: { show: true, top: 0, textStyle: { color: pal.text, fontSize: 9 }, itemWidth: 10, itemHeight: 8 },
    grid: { ...base.grid, top: 26 },
    series: stacks.map(s => ({
      type: 'bar',
      name: s.label,
      stack: 'velocity',
      barMaxWidth: 28,
      itemStyle: { color: resolve(s.color) },
      data: weeks.map(w => s.counts[w.key] ?? 0),
    })),
  };
}
