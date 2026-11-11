// @vitest-environment jsdom
// Мини-список — один компонент для квиза и для todo (SPRINT_UXR_S13_KIT4/K4-MINILIST).
//
// Владелица 11.11.2026: «в кит добавь ещё компонент мини список, нужн будет
// как для квизов так и для todo». Квизы «Дата-странников» рисовали варианты
// своей функцией в конфиге; чек-листы задач жили только в MD-теле.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MiniList } from './MiniList';

describe('K4-MINILIST · todo (check)', () => {
  const items = [
    { id: 'a', text: 'Написать тест', done: true },
    { id: 'b', text: 'Сделать код' },
    { id: 'c', text: 'Прогнать CI' },
  ];

  it('флажки с подписями и счёт «сделано 1 из 3»', () => {
    render(<MiniList kind="check" label="План" items={items} onToggle={() => {}} />);
    expect((screen.getByRole('checkbox', { name: 'Написать тест' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Сделать код' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('сделано 1 из 3')).toBeTruthy();
  });

  it('щелчок по пункту сообщает id и новое состояние', () => {
    const onToggle = vi.fn();
    render(<MiniList kind="check" label="План" items={items} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Сделать код' }));
    expect(onToggle).toHaveBeenCalledWith('b', true);
  });

  it('без onToggle — только чтение: флажки недоступны', () => {
    render(<MiniList kind="check" label="План" items={items} />);
    expect((screen.getByRole('checkbox', { name: 'Сделать код' }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('K4-MINILIST · квиз (choice)', () => {
  const opts = [
    { id: 'A', text: 'элементы обоих' },
    { id: 'B', text: 'все элементы', hint: 'это объединение' },
    { id: 'C', text: 'ничего', hint: 'пустое — только если нет общих' },
  ];

  it('варианты с буквами; выбор сообщает id', () => {
    const onPick = vi.fn();
    render(<MiniList kind="choice" label="Что даёт A ∩ B?" items={opts} onPick={onPick} />);
    const group = screen.getByRole('radiogroup', { name: 'Что даёт A ∩ B?' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByText('B')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /все элементы/ }));
    expect(onPick).toHaveBeenCalledWith('B');
  });

  it('после ответа: верный отмечен, у неверного выбранного — его подсказка', () => {
    render(<MiniList kind="choice" label="Q" items={opts} picked="B" correct="A" reveal />);
    expect(screen.getByText('это объединение')).toBeTruthy();
    expect(screen.queryByText('пустое — только если нет общих')).toBeNull();
    const a = screen.getByText('элементы обоих').closest('[data-state]') as HTMLElement;
    const b = screen.getByText('все элементы').closest('[data-state]') as HTMLElement;
    expect(a.getAttribute('data-state')).toBe('correct');
    expect(b.getAttribute('data-state')).toBe('wrong');
  });

  it('до ответа верный не выдаётся', () => {
    render(<MiniList kind="choice" label="Q" items={opts} correct="A" />);
    expect(document.querySelector('[data-state="correct"]')).toBeNull();
  });
});

describe('K4-MINILIST · простой и пустой', () => {
  it('plain — маркированный список', () => {
    render(<MiniList kind="plain" label="Состав" items={[{ id: '1', text: 'раз' }, { id: '2', text: 'два' }]} />);
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['раз', 'два']);
  });

  it('пустой список назван словами, а не пустая рамка', () => {
    render(<MiniList kind="check" label="План" items={[]} />);
    expect(screen.getByText('Пунктов нет')).toBeTruthy();
  });
});
