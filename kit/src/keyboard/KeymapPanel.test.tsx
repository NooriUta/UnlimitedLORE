// @vitest-environment jsdom
// Панель «Горячие клавиши» с переназначением (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11).
//
// Прототип v2 принят владелицей 11.11.2026 («по клавишам ок»):
//   1) правая панель; 2) открытие по «?»; 4) «Изменить» в строке, конфликт
//   запрещает сохранение; 5) — без ответа, берём минимум: «Вернуть» и
//   «Вернуть умолчание».
//   3) «на телефоне без клавиатуры пункта нет» — НЕТ: «а вдруг клавиатуру
//   подсоединить, например к планшету». Пункт и «?» работают везде.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { KeymapPanel, type KeymapGroup } from './KeymapPanel';

const groups: KeymapGroup[] = [
  { id: 'row', title: 'Строка', actions: [
    { id: 'done', title: 'Готово', hotkey: 'E' },
    { id: 'drop', title: 'Убрать', hotkey: 'Shift+D' },
  ] },
  { id: 'list', title: 'Список', builtin: true, actions: [
    { id: 'open', title: 'Открыть', hotkey: 'Enter' },
  ] },
];

const mount = (overrides = {}, onChange = vi.fn()) => {
  render(<KeymapPanel open onClose={() => {}} groups={groups} overrides={overrides} onChange={onChange} />);
  return onChange;
};

const row = (title: string) => screen.getByText(title).closest('[data-keymap-row]') as HTMLElement;

describe('S4-11 · панель «Горячие клавиши»', () => {
  it('правая панель с группами и клавишами', () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Горячие клавиши' });
    expect(dialog.closest('.sk-sheet--right') ?? dialog.className).toBeTruthy();
    expect(within(row('Готово')).getByText('E')).toBeTruthy();
    expect(screen.getByText('Строка')).toBeTruthy();
  });

  it('«Изменить» → нажать сочетание → «Сохранить» отдаёт новую раскладку', () => {
    const onChange = mount();
    fireEvent.click(within(row('Готово')).getByRole('button', { name: 'Изменить: Готово' }));
    fireEvent.keyDown(within(row('Готово')).getByRole('button', { name: /Нажмите сочетание/ }), { code: 'KeyG', key: 'g' });
    fireEvent.click(within(row('Готово')).getByRole('button', { name: 'Сохранить' }));
    expect(onChange).toHaveBeenCalledWith({ done: 'G' });
  });

  it('конфликт назван словами и сохранить нельзя', () => {
    const onChange = mount();
    fireEvent.click(within(row('Готово')).getByRole('button', { name: 'Изменить: Готово' }));
    fireEvent.keyDown(within(row('Готово')).getByRole('button', { name: /Нажмите сочетание/ }), { code: 'KeyD', key: 'D', shiftKey: true });
    expect(within(row('Готово')).getByRole('alert').textContent).toMatch(/Убрать/);
    expect((within(row('Готово')).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('клавиша kit (слой списка) тоже конфликт: Enter занят «Открыть»', () => {
    mount();
    fireEvent.click(within(row('Готово')).getByRole('button', { name: 'Изменить: Готово' }));
    fireEvent.keyDown(within(row('Готово')).getByRole('button', { name: /Нажмите сочетание/ }), { code: 'Enter', key: 'Enter' });
    expect(within(row('Готово')).getByRole('alert').textContent).toMatch(/Открыть/);
  });

  it('Esc в захвате — отмена, а не новая клавиша', () => {
    const onChange = mount();
    fireEvent.click(within(row('Готово')).getByRole('button', { name: 'Изменить: Готово' }));
    fireEvent.keyDown(within(row('Готово')).getByRole('button', { name: /Нажмите сочетание/ }), { code: 'Escape', key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(within(row('Готово')).getByRole('button', { name: 'Изменить: Готово' })).toBeTruthy();
  });

  it('переназначенная строка помечена и «Вернуть» снимает переназначение; «Вернуть умолчание» — все', () => {
    const onChange = mount({ done: 'G', drop: null });
    expect(within(row('Готово')).getByText('G')).toBeTruthy();
    expect(within(row('Убрать')).getByText('без клавиши')).toBeTruthy();
    fireEvent.click(within(row('Готово')).getByRole('button', { name: 'Вернуть: Готово' }));
    expect(onChange).toHaveBeenLastCalledWith({ drop: null });
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть умолчание' }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('клавиши kit не переназначаются — у них нет «Изменить», сказано почему', () => {
    mount();
    expect(within(row('Открыть')).queryByRole('button', { name: /Изменить/ })).toBeNull();
    expect(within(row('Открыть')).getByText('клавиша kit')).toBeTruthy();
  });

  it('поиск по действию и по клавише', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'shift+d' } });
    expect(screen.queryByText('Готово')).toBeNull();
    expect(screen.getByText('Убрать')).toBeTruthy();
  });
});
