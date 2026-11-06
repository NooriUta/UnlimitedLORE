import { useMemo } from 'react';
import EChart, { resolveCssColor } from './EChart';
import { velocityOption, type VelocityStack, type VelocityWeek } from './velocityOption';

/** Скорость по ISO-неделям на ECharts — замена прежнего SVG «Аналитики». */
export default function VelocityEChart({ weeks, stacks }: { weeks: VelocityWeek[]; stacks?: VelocityStack[] }) {
  // Тема LORE переключается атрибутом data-mode на <html> — цвета пересчитываем по нему.
  const mode = typeof document !== 'undefined' ? document.documentElement.dataset.mode ?? '' : '';
  const option = useMemo(() => velocityOption(weeks, stacks, resolveCssColor, {
    accent: resolveCssColor('var(--acc)'),
    muted: resolveCssColor('color-mix(in srgb,var(--acc) 30%,var(--b3))'),
    text: resolveCssColor('var(--t3)'),
    grid: resolveCssColor('var(--bd)'),
  }), [weeks, stacks, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const peak = Math.max(0, ...weeks.map(w => w.count));
  return <EChart option={option} height={stacks && stacks.length ? 150 : 130}
    ariaLabel={`График скорости по неделям: ${weeks.length} нед., пик ${peak} за неделю`} />;
}
