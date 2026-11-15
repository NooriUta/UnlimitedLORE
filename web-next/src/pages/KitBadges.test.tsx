// @vitest-environment jsdom
// Витрина kit: раздел «Шильдики» — статус, код записи, тип, приоритет, тег, фильтр рядом,
// и статусы по словарям типов. Слово владелицы 15.11.2026: «в витрину кит тоже добавь,
// это ценно для создания бренд-бука».
import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';
import KitBadges, { BADGE_DICTS } from './KitBadges';

describe('витрина kit · шильдики', () => {
  it('у каждого типа свой словарь статусов, и показан каждый его статус', () => {
    const { container } = render(<KitBadges />);
    for (const [type, items] of Object.entries(BADGE_DICTS)) {
      const group = container.querySelector(`[data-badge-dict="${type}"]`);
      expect(group, type).toBeTruthy();
      expect(group!.querySelectorAll('[data-status]'), type).toHaveLength(items.length);
    }
  });

  it('один код у разных типов — разные подписи: active у гейта «Работает», у задачи «В работе»', () => {
    const { container } = render(<KitBadges />);
    const gate = container.querySelector('[data-badge-dict="quality_gate"]') as HTMLElement;
    const task = container.querySelector('[data-badge-dict="task"]') as HTMLElement;
    expect(within(gate).getByText('Работает')).toBeTruthy();
    expect(within(task).getByText('В работе')).toBeTruthy();
    expect(within(gate).queryByText('В работе')).toBeNull();
  });

  it('статусы на витрине — только показ: кнопок смены статуса нет', () => {
    const { container } = render(<KitBadges />);
    expect(container.querySelectorAll('.sk-schip--btn')).toHaveLength(0);
  });

  it('строка списка: статус, код, название и приоритет стоят разными формами', () => {
    const { container } = render(<KitBadges />);
    const rows = container.querySelectorAll('[data-testid="kit-badge-row"]');
    expect(rows.length).toBeGreaterThan(2);
    const first = rows[0] as HTMLElement;
    expect(first.querySelector('.sk-schip')).toBeTruthy();
    expect(first.querySelector('.sk-pill--id')).toBeTruthy();
    expect(first.querySelector('.sk-pill--value')).toBeTruthy();
  });

  it('таблица отличий называет шесть видов шильдиков', () => {
    const { container } = render(<KitBadges />);
    expect(container.querySelectorAll('[data-testid="kit-badge-kind"]')).toHaveLength(6);
  });

  it('цвет статуса — только токен темы, сырого цвета в словарях витрины нет', () => {
    for (const items of Object.values(BADGE_DICTS)) {
      for (const s of items) expect(s.color, s.code).toMatch(/^var\(--[a-z][\w-]*\)$/);
    }
  });
});
