// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-21 (волна 1a): словарь форм v4 — «подчёркивание = вкладка,
// пилюля = действие или фильтр». Вкладки записи рисуются подчёркиванием;
// старый вид пилюлями остаётся по умолчанию, чтобы не сломать экраны, которые на него опираются.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tabs } from './Tabs';

const items = [{ id: 'a', label: 'Контент' }, { id: 'b', label: 'Граф', count: 1 }];

describe('Tabs variant', () => {
  it('по умолчанию — прежний вид, без модификатора', () => {
    render(<Tabs items={items} value="a" onChange={() => {}} label="Вкладки" />);
    expect(screen.getByRole('tablist').className).toBe('sk-tabs');
  });

  it('variant="underline" — модификатор sk-tabs--underline, счётчик на месте', () => {
    render(<Tabs items={items} value="a" onChange={() => {}} label="Вкладки" variant="underline" />);
    const list = screen.getByRole('tablist');
    expect(list.classList.contains('sk-tabs--underline')).toBe(true);
    expect(screen.getByRole('tab', { name: /Граф/ }).querySelector('.sk-tab__count')?.textContent).toBe('1');
  });
});
