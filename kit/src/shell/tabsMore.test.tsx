// @vitest-environment jsdom
// Редкие вкладки — под «Ещё», и выбранная никогда не прячется
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29, просьба владелицы 09.11.2026).
//
// Её слова: «а зависимости и прочее можно скрыть под море и сделать настройкой
// интерфейс становиться перегруженным» («под море» = под more).
//
// ЧТО ЗДЕСЬ ФОРМА, А ЧТО ДАННЫЕ. Какие разделы редкие — решает приложение (у
// LORE это умолчание модели `surfaces.passport.<type>.sections.default_visible`
// плюс личная настройка человека). kit получает готовый признак `secondary` и
// только рисует: в ряд или под свёртку. Тот же водораздел, что в K-14.
//
// ОДНО ПРАВИЛО ВАЖНЕЕ ОСТАЛЬНЫХ: выбранная вкладка видна ВСЕГДА, даже если она
// из редких. Спрятать то, что человек сейчас читает, — хуже перегруженности:
// он перестаёт понимать, где находится.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Tabs, type TabItem } from './Tabs';

const items: TabItem[] = [
  { id: 'tasks', label: 'Задачи', count: 59 },
  { id: 'content', label: 'Контент' },
  { id: 'phases', label: 'Фазы', secondary: true },
  { id: 'deps', label: 'Зависит от', secondary: true },
  { id: 'blocks', label: 'Блокирует', secondary: true },
];

const show = (value = 'tasks', onChange = vi.fn()) => {
  const r = render(<Tabs items={items} value={value} onChange={onChange} label="Разделы" />);
  return { ...r, onChange };
};

/** Вкладки в ряду (без содержимого свёртки). */
const inRow = () =>
  Array.from(screen.getByRole('tablist').querySelectorAll('[role="tab"]')).map(e => e.textContent ?? '');

describe('вкладки: редкие под «Ещё»', () => {
  it('положительный контроль: без признака `secondary` все вкладки в ряду', () => {
    render(<Tabs items={items.map(i => ({ ...i, secondary: false }))} value="tasks" onChange={() => {}} label="Разделы" />);
    expect(inRow()).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /Ещё/ })).toBeNull();
  });

  it('редкие в ряду не показываются, а их число названо', () => {
    show();
    const row = inRow().join(' · ');
    expect(row).toContain('Задачи');
    expect(row).toContain('Контент');
    expect(row).not.toContain('Фазы');
    // Сколько спрятано — числом: «Ещё» без числа не говорит, стоит ли открывать.
    expect(screen.getByRole('button', { name: /Ещё.*3/ })).toBeTruthy();
  });

  it('«Ещё» открывает список редких, и выбор переключает вкладку', () => {
    const { onChange } = show();
    fireEvent.click(screen.getByRole('button', { name: /Ещё/ }));
    const pop = screen.getByRole('menu', { name: /Ещё/ });
    expect(within(pop).getAllByRole('menuitem')).toHaveLength(3);
    fireEvent.click(within(pop).getByRole('menuitem', { name: /Зависит от/ }));
    expect(onChange).toHaveBeenCalledWith('deps');
  });

  it('ВЫБРАННАЯ редкая вкладка видна в ряду — иначе непонятно, где находишься', () => {
    show('deps');
    const row = inRow().join(' · ');
    expect(row).toContain('Зависит от');
    // Остальные редкие по-прежнему спрятаны, и их теперь двое.
    expect(row).not.toContain('Фазы');
    expect(screen.getByRole('button', { name: /Ещё.*2/ })).toBeTruthy();
  });

  it('все редкие спрятаны и выбрана частая — «Ещё» всё равно есть', () => {
    show('content');
    expect(screen.getByRole('button', { name: /Ещё.*3/ })).toBeTruthy();
  });

  it('свёртка закрывается по Esc — она всплывающая, а не вторая строка вкладок', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /Ещё/ }));
    expect(screen.getByRole('menu', { name: /Ещё/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu', { name: /Ещё/ }), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: /Ещё/ })).toBeNull();
  });

  it('клавиатура ряда не ломается: стрелка идёт по ВИДИМЫМ вкладкам', () => {
    const { onChange } = show();
    const tasks = screen.getByRole('tab', { name: /Задачи/ });
    fireEvent.keyDown(tasks, { key: 'ArrowRight' });
    // Следующая видимая — «Контент», а не спрятанные «Фазы».
    expect(onChange).toHaveBeenCalledWith('content');
  });
});
