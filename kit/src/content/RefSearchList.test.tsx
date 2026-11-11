// @vitest-environment jsdom
// Список выбора записи — общий для мини-окна ссылки в MD (RefPicker) и ref-редактора поля
// (kit/src/fields, S4-FIELD-EDITORS): один выбор записи на весь kit, а не два разных.
// Честные состояния словами: не спрашивали ≠ ищу ≠ не нашлось ≠ не смогли загрузить.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { RefSearchList } from './RefSearchList';
import type { RefSearchListHandle, RefSearchListProps } from './RefSearchList';

const items = [
  { id: 'A-1', type: 'adr', title: 'Первое' },
  { id: 'A-2', type: 'adr', title: 'Второе' },
];

function setup(over: Partial<RefSearchListProps> = {}) {
  const props: RefSearchListProps = { search: { state: 'ok', items }, query: 'пе', typeLabels: { adr: 'ADR' }, onPick: vi.fn(), ...over };
  const ref = createRef<RefSearchListHandle>();
  render(<RefSearchList ref={ref} {...props} />);
  return { props, ref };
}

describe('RefSearchList', () => {
  it('пункты: тип подписью, ID, название; щелчок — выбор', () => {
    const { props } = setup();
    expect(screen.getAllByText('ADR')).toHaveLength(2);
    fireEvent.click(screen.getByText('A-2'));
    expect(props.onPick).toHaveBeenCalledWith(items[1]);
  });
  it('стрелки по кругу и Enter — через handleKey (фокус у вызывающего)', () => {
    const { props, ref } = setup();
    act(() => { ref.current!.handleKey('ArrowUp'); });
    act(() => { ref.current!.handleKey('Enter'); });
    expect(props.onPick).toHaveBeenCalledWith(items[1]);
  });
  it('пустой список клавиши не забирает', () => {
    const { ref } = setup({ search: { state: 'ok', items: [] } });
    let used = true;
    act(() => { used = ref.current!.handleKey('ArrowDown'); });
    expect(used).toBe(false);
  });
  it('idle — «введите слова поиска», не «не нашлось»', () => {
    setup({ search: { state: 'idle' } });
    expect(screen.getByText(/Введите слова поиска/)).toBeTruthy();
    expect(screen.queryByText(/Не нашлось/)).toBeNull();
  });
  it('не нашлось — с запросом; кнопка «Завести новый» только если её дали', () => {
    const onCreateNew = vi.fn();
    setup({ search: { state: 'ok', items: [] }, onCreateNew });
    expect(screen.getByText(/Не нашлось/).textContent).toContain('пе');
    fireEvent.click(screen.getByRole('button', { name: /Завести новый/ }));
    expect(onCreateNew).toHaveBeenCalled();
  });
  it('ошибка — причина и «Повторить», не пустой список', () => {
    const onRetry = vi.fn();
    setup({ search: { state: 'error', reason: '503' }, onRetry });
    expect(screen.getByText(/Не смогли загрузить/).textContent).toContain('503');
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(onRetry).toHaveBeenCalled();
  });
});
