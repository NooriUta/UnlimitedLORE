// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35 — выбор колонок в меню «Вид».
//
// Эталон — прототип владелицы docs/prototypes/s4-35-columns.html:
//   • раздел «Колонки» в «Вид ▾», чекбоксы по полям типа;
//   • «Запись» не выключается — список без названия нечитаем;
//   • порядок — перетаскиванием строки;
//   • набор колонок уходит в адрес (?cols=), ширины — нет.
//
// Решение владелицы 08.11.2026: «ширина личная, набор командный», и
// «у дочек свои колонки, у родителя свои — см. модель»: набор колонок —
// свойство типа, kit лишь показывает и отдаёт выбор наружу.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
// Два файла: компонент и разбор адреса. Имена различаются не только
// регистром — на Windows такие файлы слились бы в один при импорте.
import { ColumnsChoice } from './ColumnsChoice';
import { columnsFromUrl } from './columnsUrl';

const ALL = [
  { key: 'title+id', title: 'Запись', locked: true },
  { key: 'status', title: 'Статус' },
  { key: 'fields.priority', title: 'Приоритет' },
  { key: 'fields.release', title: 'Релиз' },
];

function open(chosen: string[] = ['title+id', 'status'], onChange = vi.fn()) {
  render(<ColumnsChoice all={ALL} chosen={chosen} onChange={onChange} />);
  return onChange;
}

describe('S4-35 · выбор колонок', () => {
  it('показывает все колонки типа, отмечая выбранные', () => {
    open();
    const list = screen.getByTestId('cols-list');
    expect(within(list).getAllByRole('checkbox')).toHaveLength(4);
    expect((within(list).getByRole('checkbox', { name: 'Статус' }) as HTMLInputElement).checked).toBe(true);
    expect((within(list).getByRole('checkbox', { name: 'Приоритет' }) as HTMLInputElement).checked).toBe(false);
  });

  it('«Запись» не выключается: список без названия нечитаем', () => {
    open();
    const rec = screen.getByRole('checkbox', { name: 'Запись' }) as HTMLInputElement;
    expect(rec.checked).toBe(true);
    expect(rec.disabled).toBe(true);
  });

  it('включение колонки отдаётся наружу — хранит приложение, не kit', () => {
    const onChange = open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Приоритет' }));
    expect(onChange).toHaveBeenCalledWith(['title+id', 'status', 'fields.priority']);
  });

  it('выключение убирает колонку, сохраняя порядок остальных', () => {
    const onChange = open(['title+id', 'status', 'fields.priority']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Статус' }));
    expect(onChange).toHaveBeenCalledWith(['title+id', 'fields.priority']);
  });

  it('порядок меняется кнопками «выше/ниже» — перетаскивание не единственный путь', () => {
    // Перетаскивание недоступно с клавиатуры, поэтому у каждой строки есть
    // кнопки; иначе колонки не переставить без мыши (S4-12, доступность).
    const onChange = open(['title+id', 'status', 'fields.priority']);
    fireEvent.click(screen.getByRole('button', { name: /Приоритет.*выше/i }));
    expect(onChange).toHaveBeenCalledWith(['title+id', 'fields.priority', 'status']);
  });

  it('«Запись» держит первое место: мёртвых кнопок нет', () => {
    // У самой «Записи» стрелок нет вовсе, а у колонки сразу за ней нет
    // «выше» — двигаться некуда. Показать кнопку, которая ничего не делает,
    // было бы хуже: человек жмёт и не понимает, почему не работает.
    open(['title+id', 'status']);
    // У самой «Записи» стрелок нет.
    expect(screen.queryByRole('button', { name: /Запись/i })).toBeNull();
    // «Статус» стоит сразу за ней и единственный из подвижных: вверх нельзя
    // (там «Запись»), вниз тоже (он последний) — значит стрелок нет совсем.
    expect(screen.queryByRole('button', { name: /Статус/i })).toBeNull();
  });

  it('у средней колонки обе стрелки, у последней — только «выше»', () => {
    open(['title+id', 'status', 'fields.priority']);
    expect(screen.getByRole('button', { name: /Статус.*ниже/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Статус.*выше/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Приоритет.*выше/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Приоритет.*ниже/i })).toBeNull();
  });
});

describe('S4-35 · набор колонок в адресе', () => {
  it('читает ?cols= и оставляет только известные колонки', () => {
    const known = ALL.map(c => c.key);
    expect(columnsFromUrl('cols=title%2Bid,status,fields.priority', known))
      .toEqual(['title+id', 'status', 'fields.priority']);
  });

  it('неизвестная колонка в адресе отбрасывается, а не ломает список', () => {
    const known = ALL.map(c => c.key);
    expect(columnsFromUrl('cols=title%2Bid,fields.gone,status', known)).toEqual(['title+id', 'status']);
  });

  it('«Запись» возвращается, даже если её убрали из адреса руками', () => {
    const known = ALL.map(c => c.key);
    expect(columnsFromUrl('cols=status', known, 'title+id')).toEqual(['title+id', 'status']);
  });

  it('адреса нет или параметр пуст — undefined: это не «колонок нет»', () => {
    const known = ALL.map(c => c.key);
    expect(columnsFromUrl('', known)).toBeUndefined();
    expect(columnsFromUrl('cols=', known)).toBeUndefined();
    expect(columnsFromUrl('cols=fields.gone', known)).toBeUndefined();
  });
});
