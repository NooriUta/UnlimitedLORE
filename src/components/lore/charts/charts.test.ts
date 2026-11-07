import { describe, expect, it } from 'vitest';
import { CHART_LAYER_KEY, readChartLayer } from './chartLayer';
import { velocityOption } from './velocityOption';

/**
 * Графики LORE на ECharts со вторым слоем Völva (решение владелицы 06.11.2026:
 * «встроенный echarts … и встроенная volva — слои работают либо то либо другое»;
 * «настройку … делать в админке, хранить в LORE»).
 */
describe('слой графиков', () => {
  const row = (code: string, label_ru: string | null, is_active = true) => ({ dict_type: 'app_setting', code, label_ru, is_active });

  it('по умолчанию — echarts: настройки нет, пусто, мусор, выключена', () => {
    expect(readChartLayer([])).toBe('echarts');
    expect(readChartLayer([row(CHART_LAYER_KEY, null)])).toBe('echarts');
    expect(readChartLayer([row(CHART_LAYER_KEY, 'что-то')])).toBe('echarts');
    expect(readChartLayer([row(CHART_LAYER_KEY, 'volva', false)])).toBe('echarts');
  });

  it('volva — только явным значением, регистр и пробелы не важны', () => {
    expect(readChartLayer([row(CHART_LAYER_KEY, 'volva')])).toBe('volva');
    expect(readChartLayer([row(CHART_LAYER_KEY, ' Völva ')])).toBe('volva');
    expect(readChartLayer([row('other.key', 'volva')])).toBe('echarts');
  });
});

describe('option скорости', () => {
  const weeks = [
    { key: '2026-W43', label: 'W43', count: 3, isCurrent: false },
    { key: '2026-W44', label: 'W44', count: 0, isCurrent: false },
    { key: '2026-W45', label: 'W45', count: 5, isCurrent: true },
  ];
  const c = (v: string) => v; // цвета уже разрешены

  it('без стопок — одна серия, нулевая неделя остаётся нулём, текущая подсвечена', () => {
    const o = velocityOption(weeks, undefined, c, { accent: '#a', muted: '#m', text: '#t', grid: '#g' });
    expect(o.xAxis.data).toEqual(['W43', 'W44', 'W45']);
    expect(o.series).toHaveLength(1);
    expect(o.series[0].data.map((d: { value: number }) => d.value)).toEqual([3, 0, 5]);
    expect(o.series[0].data[2].itemStyle.color).toBe('#a');
    expect(o.series[0].data[0].itemStyle.color).toBe('#m');
  });

  it('со стопками — серия на проект, общий stack, пропуски нулём', () => {
    const stacks = [
      { label: 'LORE', color: '#1', counts: { '2026-W43': 2, '2026-W45': 4 } },
      { label: 'AIDA', color: '#2', counts: { '2026-W43': 1, '2026-W45': 1 } },
    ];
    const o = velocityOption(weeks, stacks, c, { accent: '#a', muted: '#m', text: '#t', grid: '#g' });
    expect(o.series.map((s: { name: string }) => s.name)).toEqual(['LORE', 'AIDA']);
    expect(o.series.every((s: { stack: string }) => s.stack === 'velocity')).toBe(true);
    expect(o.series[0].data).toEqual([2, 0, 4]);
    expect(o.legend.show).toBe(true);
  });
});

describe('проверка интеграции Völva — исход по коду ответа', async () => {
  const { volvaCheckVerdict } = await import('../admin/SettingsTab');
  const { LoreHttpError } = await import('../../../api/lore');
  it('503 → не настроено, 404 → нет графика, 403 → нет доступа, прочее → ошибка', () => {
    expect(volvaCheckVerdict(new LoreHttpError(503, 'NOT_CONFIGURED', 'нет секрета')).kind).toBe('not_configured');
    expect(volvaCheckVerdict(new LoreHttpError(404, 'UNKNOWN_CHART', '')).kind).toBe('unknown_chart');
    expect(volvaCheckVerdict(new LoreHttpError(403, 'FORBIDDEN', '')).kind).toBe('forbidden');
    expect(volvaCheckVerdict(new Error('сеть')).kind).toBe('error');
  });
});
