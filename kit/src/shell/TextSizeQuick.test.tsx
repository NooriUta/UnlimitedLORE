// @vitest-environment jsdom
// Быстрые A− / A+ над СУЩЕСТВУЮЩЕЙ осью размера текста
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-16).
//
// Повод — владелица 10.11.2026: «очень крупно» на телефоне. Разбор показал,
// что размер текста у нас УЖЕ есть: ступени sm/md/lg/xl (`data-text-size`,
// шкалы в seidr.css) и личная настройка `text_size`. Ступень xl добавлена
// 09.11 по её же просьбе про 4К-монитор — и та же настройка приезжает на
// телефон, где читается как «очень крупно».
//
// Чего не хватало — не механизма, а быстрого доступа: чтобы сменить ступень,
// надо было уходить в настройки. Этот орган управления и есть недостающее.
//
// ГЛАВНОЕ ПРАВИЛО, которое держит этот файл: второй оси размера НЕТ. Я начала
// было делать свой множитель `--fs-k` и остановилась, увидев существующий
// механизм: две правды о размере текста хуже, чем отсутствие быстрых кнопок.
// Поэтому проверка явно запрещает множитель в теме и требует, чтобы кнопки
// ходили ровно по TEXT_SIZES.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { KitLangProvider } from '../i18n';
import { TEXT_SIZES, DEFAULT_DISPLAY, type TextSize } from '../tokens/prefs';
import { TextSizeQuick, stepTextSize } from './TextSizeQuick';

const show = (value: TextSize, onChange = vi.fn()) => {
  render(<KitLangProvider lang="ru"><TextSizeQuick value={value} onChange={onChange} /></KitLangProvider>);
  return onChange;
};

describe('S4-16 · шаг по существующей оси размеров', () => {
  it('положительный контроль: ось та самая, умолчание среди ступеней', () => {
    expect([...TEXT_SIZES]).toEqual(['sm', 'md', 'lg', 'xl']);
    expect(TEXT_SIZES).toContain(DEFAULT_DISPLAY.textSize);
  });

  it('шаг идёт по ступеням оси, а не по выдуманным числам', () => {
    expect(stepTextSize('md', 1)).toBe('lg');
    expect(stepTextSize('md', -1)).toBe('sm');
  });

  it('с краю остаётся край: шагать некуда — значение не меняется', () => {
    expect(stepTextSize('xl', 1)).toBe('xl');
    expect(stepTextSize('sm', -1)).toBe('sm');
  });

  it('чужое значение — это «выбора не было», а не «мельче всех»', () => {
    expect(stepTextSize('огромный' as TextSize, 1)).toBe('lg');
    expect(stepTextSize(undefined as unknown as TextSize, -1)).toBe('sm');
  });
});

describe('S4-16 · орган управления', () => {
  it('положительный контроль: обе кнопки и нынешняя ступень на экране', () => {
    show('md');
    expect(screen.getByRole('button', { name: /мельче/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /крупнее/i })).toBeTruthy();
    expect(screen.getByTestId('kit-text-size').getAttribute('data-value')).toBe('md');
  });

  it('нажатие отдаёт СЛЕДУЮЩУЮ ступень оси', () => {
    const onChange = show('md');
    fireEvent.click(screen.getByRole('button', { name: /крупнее/i }));
    expect(onChange).toHaveBeenCalledWith('lg');
  });

  it('на краю шкалы кнопка выключена — нажатие в никуда читается как поломка', () => {
    show('xl');
    expect((screen.getByRole('button', { name: /крупнее/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /мельче/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('у группы есть подпись: без неё с клавиатуры и вслух это «кнопка А»', () => {
    show('md');
    expect(screen.getByRole('group', { name: /размер текста/i })).toBeTruthy();
  });
});

describe('S4-16 · второй оси размера нет', () => {
  it('в теме нет собственного множителя кеглей', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/seidr.css'), 'utf8');
    expect(css, 'появился второй способ задавать размер текста').not.toContain('--fs-k');
  });

  it('ступени шкалы живут только в теме: орган управления своих чисел не знает', () => {
    const src = readFileSync(join(process.cwd(), 'src/shell/TextSizeQuick.tsx'), 'utf8');
    // Числа кеглей в компоненте означали бы, что размер задаётся в двух местах.
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\b\d+px\b/);
  });
});
