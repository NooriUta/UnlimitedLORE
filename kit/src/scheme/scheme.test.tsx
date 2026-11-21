// @vitest-environment jsdom
// «Схема» — общая смотрелка плана (SPRINT_UXR_S15_KIT6; владелица 21.11.2026: «доделай», пункт 4 — «Схема»
// для плана этажа). Контуры областей, точки со статусом, слои чипами, этажи, масштаб; правка плана — у приложения.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SchemeView, schemeBounds, type SchemeArea, type SchemePoint } from '.';

const areas: SchemeArea[] = [
  { id: 'kitchen', label: 'Кухня', floor: 1, ring: [[0, 0], [4, 0], [4, 3], [0, 3]] },
  { id: 'living', label: 'Гостиная', floor: 1, ring: [[4, 0], [10, 0], [10, 5], [4, 5]] },
  { id: 'bed', label: 'Спальня', floor: 2, ring: [[0, 0], [4, 0], [4, 4], [0, 4]] },
];
const points: SchemePoint[] = [
  { id: 'n1', floor: 1, at: [2, 1.5], layer: 'sensor', tone: 'ok', label: 'Датчик кухни' },
  { id: 'l1', floor: 1, at: [7, 2], layer: 'light', tone: 'warn', label: 'Люстра' },
  { id: 'l2', floor: 2, at: [1, 1], layer: 'light', tone: 'muted', label: 'Ночник' },
  { id: 'x', floor: 1, at: null, layer: 'light', tone: 'muted', label: 'Без места' },
];
const layers = [{ id: 'sensor', label: 'Датчики' }, { id: 'light', label: 'Свет' }];

describe('границы схемы', () => {
  it('по контурам и точкам этажа, с полями', () => {
    const b = schemeBounds(areas.filter((a) => a.floor === 1), points.filter((p) => p.floor === 1));
    expect(b).toEqual({ x: -0.5, y: -0.5, w: 11, h: 6 });
  });
  it('пусто — null (экран скажет словами)', () => {
    expect(schemeBounds([], [])).toBeNull();
  });
});

describe('SchemeView', () => {
  it('рисует контуры и точки текущего этажа; слои — чипы с числом', () => {
    const { container } = render(<SchemeView areas={areas} points={points} layers={layers} floors={[1, 2]} />);
    expect(container.querySelectorAll('.sk-scheme__area')).toHaveLength(2);
    expect(container.querySelectorAll('.sk-scheme__point')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Свет 1/ })).toBeTruthy();
  });
  it('точки без места не теряются молча — счётчик словами', () => {
    render(<SchemeView areas={areas} points={points} layers={layers} floors={[1, 2]} />);
    expect(screen.getByText(/без места: 1/)).toBeTruthy();
  });
  it('слой выключается чипом', () => {
    const { container } = render(<SchemeView areas={areas} points={points} layers={layers} floors={[1, 2]} />);
    fireEvent.click(screen.getByRole('button', { name: /Свет 1/ }));
    expect(container.querySelectorAll('.sk-scheme__point')).toHaveLength(1);
  });
  it('этаж переключается; выбор точки зовёт onSelect', () => {
    const onSelect = vi.fn();
    const { container } = render(<SchemeView areas={areas} points={points} layers={layers} floors={[1, 2]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(container.querySelectorAll('.sk-scheme__area')).toHaveLength(1);
    fireEvent.click(container.querySelector('.sk-scheme__point')!);
    expect(onSelect).toHaveBeenCalledWith('l2');
  });
  it('нет плана — словами, а не пустой холст', () => {
    render(<SchemeView areas={[]} points={[]} layers={layers} floors={[1]} empty="план дома не загружен" />);
    expect(screen.getByText('план дома не загружен')).toBeTruthy();
  });
});
