// @vitest-environment jsdom
// Вход @seidr/kit/charts-echarts: импорт = регистрация рисовальщика; график рисуется в общей рамке kit.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KitChartsProvider, LineChart, BarChart } from '../charts';
import './index';

describe('echarts как рисовальщик kit', () => {
  it('после импорта входа рычаг echarts рисует телом echarts, а не SVG kit и не «не подключён»', () => {
    const { container } = render(
      <KitChartsProvider renderer="echarts">
        <LineChart title="Кухня" unit="°C" series={[{ key: 't', label: 'т', points: [{ x: 1, y: 20 }, { x: 2, y: null }, { x: 3, y: 22 }] }]} />
      </KitChartsProvider>);
    expect(container.querySelector('svg.sk-chart__svg')).toBeNull();
    expect(screen.getByRole('img', { name: 'Кухня' })).toBeTruthy();
    expect(screen.queryByText(/не подключён/)).toBeNull();
  });
  it('столбики — тоже; сводка «макс · мин» общая', () => {
    render(
      <KitChartsProvider renderer="echarts">
        <BarChart title="Комнаты" unit="°C" groups={[{ key: 't', label: 'т' }]} data={[{ category: 'Кухня', values: { t: 22 } }, { category: 'Ванная', values: { t: null } }]} />
      </KitChartsProvider>);
    expect(screen.getByRole('img', { name: 'Комнаты' })).toBeTruthy();
    expect(screen.getByTestId('kit-chart-summary')).toBeTruthy();
  });
});
