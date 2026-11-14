// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-TARGET — «Цель к сроку»: доработка графика сгорания
// (разбор kit по продуктам 11.11: нужна только LORE, отдельный вид не заводим).
// Владелица 12.11: «да» на старт.
//
// Что добавляет kit: отметку срока, план к сроку (прямая до объёма в день срока —
// геометрия, без предметных слов), линию прогноза и вердикт словами — их считает
// ПРИЛОЖЕНИЕ (K-14); ряд по родителю — сумма рядов частей; мини-сгорание в строку.
// Честные состояния: срока нет — отметки и плана нет, и это сказано; прогноза нет —
// линии нет, вердикт без прогноза не выдумывается.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BurnChart, BurnSpark, burnSum, burnSeries } from '../index';
/** Принадлежность группе задаёт приложение (K-14); здесь — «спринт S» в формате LORE. */
const inS = (uid: string) => uid.startsWith('S/');

const C = (task_uid: string, valid_from: string) => ({ task_uid, valid_from });
const POINTS = burnSeries(
  [C('S/A', '2026-11-01'), C('S/B', '2026-11-01'), C('S/C', '2026-11-02'), C('S/D', '2026-11-02')],
  [C('S/A', '2026-11-03'), C('S/B', '2026-11-05')],
  inS,
);

describe('K2-VIEW-TARGET · срок, план, прогноз, вердикт', () => {
  it('срок — вертикальная отметка с датой; план к сроку — до объёма в день срока (burnup)', () => {
    const { container } = render(<BurnChart state="ok" points={POINTS} deadline="2026-11-10" defaultMode="burnup" defaultExpanded />);
    const mark = container.querySelector('[data-series="deadline"]')!;
    expect(mark).not.toBeNull();
    const plan = container.querySelector('[data-series="plan"]')!.getAttribute('points')!.trim().split(' ');
    // план кончается в день срока на уровне объёма — правый край оси (срок дальше данных).
    const [px, py] = plan[plan.length - 1].split(',').map(Number);
    expect(px).toBe(600);
    expect(py).toBe(4);
    expect(container.querySelector('.sk-burn__axis')!.textContent).toContain('2026-11-10');
  });

  it('прогноз приложения — пунктирной линией; ось тянется до последней точки прогноза', () => {
    const { container } = render(<BurnChart state="ok" points={POINTS} defaultMode="burnup" defaultExpanded
      forecast={[{ date: '2026-11-05', done: 2 }, { date: '2026-11-12', done: 4 }]} />);
    expect(container.querySelector('[data-series="forecast"]')).not.toBeNull();
    expect(container.querySelector('.sk-burn__axis')!.textContent).toContain('2026-11-12');
  });

  it('вердикт словами — в свёрнутом заголовке, с тоном; без вердикта — ничего не выдумываем', () => {
    const { rerender } = render(<BurnChart state="ok" points={POINTS} verdict={{ tone: 'late', text: 'Не успеваем на 3 дня' }} />);
    const v = screen.getByTestId('kit-burn-verdict');
    expect(v.textContent).toBe('Не успеваем на 3 дня');
    expect(v.getAttribute('data-tone')).toBe('late');
    rerender(<BurnChart state="ok" points={POINTS} />);
    expect(screen.queryByTestId('kit-burn-verdict')).toBeNull();
  });

  it('срок задан, а данных нет — сказано «нет истории», а не пустой график', () => {
    render(<BurnChart state="empty" deadline="2026-11-10" defaultExpanded />);
    expect(screen.getAllByText(/задач нет|нет истории/i).length).toBeGreaterThan(0);
  });

  it('у объекта срока нет (deadline=null) — плана и отметки нет, и это сказано словами', () => {
    render(<BurnChart state="ok" points={POINTS} defaultMode="burnup" defaultExpanded deadline={null} />);
    expect(document.querySelector('[data-series="plan"]')).toBeNull();
    expect(screen.getByText(/срок не задан/i)).toBeTruthy();
  });
});

describe('K2-VIEW-TARGET · ряд по родителю и мини-сгорание', () => {
  it('сумма рядов частей: по каждой дате — последнее известное значение каждой части', () => {
    const a = [{ date: '2026-11-01', scope: 2, done: 0, remaining: 2 }, { date: '2026-11-03', scope: 2, done: 1, remaining: 1 }];
    const b = [{ date: '2026-11-02', scope: 3, done: 0, remaining: 3 }];
    expect(burnSum([a, b])).toEqual([
      { date: '2026-11-01', scope: 2, done: 0, remaining: 2 },
      { date: '2026-11-02', scope: 5, done: 0, remaining: 5 },
      { date: '2026-11-03', scope: 5, done: 1, remaining: 4 },
    ]);
    expect(burnSum([])).toEqual([]);
  });

  it('мини-сгорание в строку: готово и объём, подпись для чтения; меньше двух точек — «мало истории»', () => {
    const { container, rerender } = render(<BurnSpark points={POINTS} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toMatch(/2.*4/);
    expect(container.querySelector('[data-series="done"]')).not.toBeNull();
    rerender(<BurnSpark points={POINTS.slice(0, 1)} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toMatch(/мало истории/);
  });
});
