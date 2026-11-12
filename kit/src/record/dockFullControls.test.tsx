// @vitest-environment jsdom
// Паспорт на всю ширину: «×» не спорит с «Выйти из полноэкранного» и не ломает
// строку вкладок (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-17). Владелица 11.11.2026:
// «паспорт когда открывается на всю ширину экрана, верхнее меню немного
// сломано, и крестик спорят с линией».
//
// Причина: в полном экране «×» плавал (float: right) и прилипал внутри панели,
// а «Выйти из полноэкранного» стоял абсолютно в углу дока. При прокрутке «×»
// вставал поверх «Выйти», а плавающий элемент сужал соседний блок — всю запись
// со строкой вкладок (на телефоне это уже снимали отрицательным полем, на
// десктопе — нет). Теперь в полном экране обе кнопки — одной группой в углу.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RecordDock } from './RecordDock';

const css = readFileSync(resolve(__dirname, '../styles/seidr.css'), 'utf8');

describe('док на всю ширину: кнопки управления', () => {
  it('«Выйти из полноэкранного» и «×» — одной группой вне панели записи', () => {
    render(<RecordDock placement="full" onClose={() => {}} onExitFull={() => {}}><p>паспорт</p></RecordDock>);
    const close = screen.getByRole('button', { name: 'Закрыть паспорт' });
    const exit = screen.getByRole('button', { name: /полного экрана/i });
    expect(close.parentElement).toBe(exit.parentElement);
    expect(close.closest('.sk-dock__panel')).toBeNull();
    expect(close.parentElement?.className).toContain('sk-dock__ctl');
  });

  it('справа и снизу — «×» по-прежнему в панели (там выхода из полного экрана нет)', () => {
    render(<RecordDock placement="right" onClose={() => {}}><p>паспорт</p></RecordDock>);
    expect(screen.getByRole('button', { name: 'Закрыть паспорт' }).closest('.sk-dock__panel')).toBeTruthy();
  });

  it('кнопки — своей полосой сверху, а не поверх прокручиваемой панели; без float', () => {
    const rule = css.match(/\.sk-dock__ctl\s*\{([^}]*)\}/);
    expect(rule, 'нет правила .sk-dock__ctl').toBeTruthy();
    expect(rule![1]).not.toMatch(/position:\s*absolute|float/);
    expect(css).toMatch(/\.sk-dock\[data-placement='full'\]\s*\{\s*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
  });
});
