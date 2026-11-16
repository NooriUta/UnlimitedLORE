// @vitest-environment jsdom
// Графики одним семейством (SPRINT_UXR_S13_KIT4/K4-CHARTS). Прототип k4-charts.html утверждён
// владелицей 14.11.2026 («все» — четыре рекомендации): heat — отдельный вид; пропуск в линии —
// разрыв и полоса «нет данных», а не ноль; ось Y у столбиков от нуля, у линий и точек — по данным.
//
// Общие правила одним местом: одна ось; «нет данных» ≠ 0; «не загрузилось» с причиной и
// «Повторить»; «показана часть» с числом; цвета — только токены; у каждого — «Таблицей» и сводка.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { KitLangProvider } from '../i18n';
import { BarChart, HeatChart, LineChart, ScatterChart, niceTicks } from './family';

const wrap = (n: React.ReactNode) => render(<KitLangProvider lang="ru">{n}</KitLangProvider>);
const T0 = Date.parse('2026-10-03T00:00:00Z');
const DAY = 86_400_000;

describe('ось: один расчёт делений', () => {
  it('круглые деления 1·2·5×10ⁿ, только в пределах, которых данные достигают', () => {
    expect(niceTicks(61, 77)).toEqual([65, 70, 75]);
    expect(niceTicks(0, 34)).toEqual([0, 10, 20, 30]);
    expect(niceTicks(18.1, 24.6)).toEqual([20, 22, 24]);
  });
  it('все значения равны — одно деление, а не деление на ноль', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});

describe('line: числа во времени', () => {
  const series = [
    { key: 'q', label: 'qwen3-32b', points: [0, 1, 2, 3, 4].map(i => ({ x: T0 + i * DAY, y: [71, 72, null, 74, 77][i] })) },
  ];
  it('пропуск — разрыв линии и полоса «нет данных», а не ноль', () => {
    const { container } = wrap(<LineChart title="Дрейф" series={series} />);
    const path = container.querySelector('[data-series="q"]')!.getAttribute('d')!;
    expect(path.match(/M/g)).toHaveLength(2); // два отрезка — разрыв
    expect(container.querySelectorAll('[data-gap]').length).toBe(1);
    expect(screen.getByTestId('kit-chart-summary').textContent).toContain('мин 71');
    expect(screen.getByTestId('kit-chart').textContent).toMatch(/нет данных/i);
  });
  it('сводка «макс / мин / последнее» текстом над графиком', () => {
    wrap(<LineChart title="Дрейф" series={series} unit="балл" />);
    const s = screen.getByTestId('kit-chart-summary').textContent!;
    expect(s).toContain('макс 77');
    expect(s).toContain('последнее 77');
  });
  it('«Таблицей» — те же данные строками; пропуск словами', () => {
    wrap(<LineChart title="Дрейф" series={series} />);
    fireEvent.click(screen.getByRole('button', { name: 'Таблицей' }));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 5);
    expect(table.textContent).toContain('нет данных');
    expect(table.textContent).toContain('77');
  });
});

describe('bar: ось Y от нуля', () => {
  it('нижнее деление — 0, даже если данные начинаются с 5', () => {
    const { container } = wrap(<BarChart title="Доля" groups={[{ key: 'a', label: 'статьи' }]}
      data={[{ category: 'Хабр', values: { a: 34 } }, { category: 'LinkedIn', values: { a: 5 } }]} />);
    const ticks = [...container.querySelectorAll('[data-tick]')].map(t => t.getAttribute('data-tick'));
    expect(ticks[0]).toBe('0');
    expect(container.querySelectorAll('[data-bar]')).toHaveLength(2);
  });
});

describe('scatter и heat', () => {
  it('scatter: точка на каждую запись, подпись — у точки', () => {
    const { container } = wrap(<ScatterChart title="Парето" points={[{ x: 800, y: 74, label: 'gemini' }, { x: 2300, y: 86, label: 'claude' }]} />);
    expect(container.querySelectorAll('[data-point]')).toHaveLength(2);
    expect(container.textContent).toContain('claude');
  });
  it('heat: число в каждой клетке; нет значения — «—», а не ноль', () => {
    wrap(<HeatChart title="Матрица" rows={['ru-wiki', 'code']} cols={['L1', 'L2']} values={[[92, 88], [84, null]]} />);
    const cells = [...document.querySelectorAll('[data-cell]')].map(c => c.textContent);
    expect(cells).toEqual(['92', '88', '84', '—']);
  });
});

describe('честные состояния и цвета', () => {
  it('не загрузилось — причина и «Повторить»', () => {
    const retry = vi.fn();
    wrap(<LineChart title="Дрейф" series={[]} error="сервер 503" onRetry={retry} />);
    expect(screen.getByText(/сервер 503/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(retry).toHaveBeenCalled();
  });
  it('пусто — словами, не пустая рамка', () => {
    wrap(<BarChart title="Доля" groups={[]} data={[]} />);
    expect(screen.getByTestId('kit-chart').textContent).toMatch(/Данных нет/);
  });
  it('показана часть — с числом', () => {
    wrap(<ScatterChart title="Парето" points={[{ x: 1, y: 2 }]} shown={1} total={40} />);
    expect(screen.getByTestId('kit-chart').textContent).toContain('1 из 40');
  });
  it('цвета — только токены темы, ни одного сырого hex', () => {
    const { container } = wrap(<LineChart title="Дрейф" series={[{ key: 'a', label: 'a', points: [{ x: T0, y: 1 }, { x: T0 + DAY, y: 2 }] }]} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(container.innerHTML).toContain('var(--');
  });
});

describe('ширина по контейнеру без растяжения (препрод 16.11: текст делений сжимался в узкой колонке)', () => {
  it('SVG не растягивают: нет preserveAspectRatio="none", ширина viewBox — ширина контейнера', () => {
    const RO = globalThis.ResizeObserver;
    let cb: ((e: { contentRect: { width: number } }[]) => void) | null = null;
    globalThis.ResizeObserver = class { constructor(f: typeof cb) { cb = f; } observe() { cb?.([{ contentRect: { width: 300 } }]); } disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
    try {
      const { container } = wrap(<LineChart title="Дрейф" series={[{ key: 'a', label: 'a', points: [{ x: T0, y: 1 }, { x: T0 + DAY, y: 2 }] }]} />);
      const svg = container.querySelector('svg.sk-chart__svg')!;
      expect(svg.getAttribute('preserveAspectRatio')).toBeNull();
      expect(svg.getAttribute('viewBox')).toBe('0 0 300 200');
    } finally { globalThis.ResizeObserver = RO; }
  });
});
