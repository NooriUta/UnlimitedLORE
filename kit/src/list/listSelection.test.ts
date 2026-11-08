// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-10 — чистая модель выделения списка: что
// считается выбранным (только показанное), переключение, «выбрать все».
import { describe, expect, it } from 'vitest';
import type { KitRecord } from '../core/contract';
import { LONG_PRESS, selectAllShown, toggleId, visibleSelection } from './listSelection';

const rec = (id: string): KitRecord => ({ id, kind: 'task', title: id, status: 'todo', fields: {} });

describe('visibleSelection — выбранное среди показанного, в порядке показа', () => {
  it('скрытое фильтром в выбор не попадает (действие не уйдёт на невидимое)', () => {
    expect(visibleSelection(new Set(['3', '1', 'gone']), [rec('1'), rec('2'), rec('3')])).toEqual(['1', '3']);
  });
  it('пустой выбор — пустой массив', () => {
    expect(visibleSelection(new Set(), [rec('1')])).toEqual([]);
  });
});

describe('toggleId / selectAllShown — без мутации входа', () => {
  it('toggleId добавляет и убирает, исходный Set не меняется', () => {
    const a = new Set(['1']);
    const b = toggleId(a, '2');
    expect([...b].sort()).toEqual(['1', '2']);
    expect([...toggleId(b, '1')]).toEqual(['2']);
    expect([...a]).toEqual(['1']);
  });
  it('selectAllShown: всё показанное выбрано → снимает, иначе выбирает всё показанное', () => {
    const shown = [rec('1'), rec('2')];
    expect([...selectAllShown(new Set(['1']), shown)].sort()).toEqual(['1', '2']);
    expect([...selectAllShown(new Set(['1', '2']), shown)]).toEqual([]);
  });
});

it('долгое нажатие: порог времени и допуск сдвига заданы константами', () => {
  expect(LONG_PRESS.ms).toBeGreaterThanOrEqual(400);
  expect(LONG_PRESS.ms).toBeLessThanOrEqual(700);
  expect(LONG_PRESS.slop).toBeGreaterThan(0);
});
