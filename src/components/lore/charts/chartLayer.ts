/**
 * Слой графиков LORE: свои графики на ECharts или встройка Völva — либо то,
 * либо другое (решение владелицы 06.11.2026). Настройка одна на весь LORE,
 * хранится в LORE как app_setting и правится в админке («Настройки»).
 */
export type ChartLayer = 'echarts' | 'volva';

export const CHART_LAYER_KEY = 'charts.layer';

interface DictLike { code: string; label_ru: string | null; is_active?: boolean | null }

/**
 * Значение настройки. По умолчанию — echarts: Völva включается только явным
 * значением «volva». Пустое, неизвестное или выключенное значение не должно
 * молча увести все графики во внешнюю систему.
 */
export function readChartLayer(rows: DictLike[]): ChartLayer {
  const r = rows.find(x => x.code === CHART_LAYER_KEY && x.is_active !== false);
  const v = (r?.label_ru ?? '').trim().toLowerCase().replace('ö', 'o');
  return v === 'volva' ? 'volva' : 'echarts';
}
