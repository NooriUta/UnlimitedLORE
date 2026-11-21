// @vitest-environment jsdom
// Рычаг svg | echarts (D-2026-SEIDRKIT-ECHARTS-IN-KIT; владелица 21.11.2026: «включай echarts в kit»,
// «или оставь рычаг svg echarts», «это будет лучше»). Один API графиков kit; рисует — выбранный рисовальщик;
// рамка, сводка, «Таблицей» и честные состояния — общие. echarts подключается отдельным входом пакета.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BarChart, KitChartsProvider, LineChart, registerChartRenderer, unregisterChartRenderer } from '.';

afterEach(() => { cleanup(); unregisterChartRenderer('echarts'); });

const series = [{ key: 't', label: 'температура', points: [{ x: 1, y: 20 }, { x: 2, y: null }, { x: 3, y: 22 }] }];

describe('рычаг рисовальщика', () => {
  it('по умолчанию — свой SVG', () => {
    const { container } = render(<LineChart title="T" series={series} />);
    expect(container.querySelector('svg.sk-chart__svg')).toBeTruthy();
  });

  it('echarts выбран, но не подключён — честно SVG и строка «не подключён», а не пустое место', () => {
    const { container } = render(<KitChartsProvider renderer="echarts"><LineChart title="T" series={series} /></KitChartsProvider>);
    expect(container.querySelector('svg.sk-chart__svg')).toBeTruthy();
    expect(screen.getByText(/echarts выбран, но не подключён/)).toBeTruthy();
  });

  it('подключённый рисовальщик рисует тело; рамка, сводка и «Таблицей» остаются общими', () => {
    registerChartRenderer('echarts', {
      line: (p) => <div data-testid="ech-line">{p.series.length}</div>,
      bar: (p) => <div data-testid="ech-bar">{p.data.length}</div>,
    });
    render(<KitChartsProvider renderer="echarts"><LineChart title="T" unit="°C" series={series} /></KitChartsProvider>);
    expect(screen.getByTestId('ech-line').textContent).toBe('1');
    expect(screen.getByTestId('kit-chart-summary')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Таблиц/ }));
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('рычаг на один график главнее общего', () => {
    registerChartRenderer('echarts', { line: () => <div data-testid="ech-line" />, bar: () => <div data-testid="ech-bar" /> });
    const { container } = render(
      <KitChartsProvider renderer="echarts">
        <BarChart title="B" renderer="svg" groups={[{ key: 'v', label: 'v' }]} data={[{ category: 'a', values: { v: 1 } }]} />
      </KitChartsProvider>);
    expect(container.querySelector('svg.sk-chart__svg')).toBeTruthy();
    expect(screen.queryByTestId('ech-bar')).toBeNull();
  });
});
