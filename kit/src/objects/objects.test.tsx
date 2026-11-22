// @vitest-environment jsdom
// Элементы для «живых объектов» (SPRINT_UXR_S15_KIT6; владелица 21.11.2026 — страница «Чего нет в kit», «ok», «доделай»):
// переключатель языков, выбор картинки записи, шапка паспорта «живой объект», галерея плиток с фильтрами и группами,
// счёт «скрыто правами».
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HiddenNote, ImagePicker, LangSwitch, LiveHeader, TileGallery, galleryGroups } from '.';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

describe('LangSwitch', () => {
  it('языки — кнопками, текущий отмечен; выбор зовёт onChange', () => {
    const on = vi.fn();
    render(<LangSwitch langs={['ru', 'en', 'pl']} value="en" onChange={on} />);
    expect(screen.getByRole('button', { name: 'en' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'pl' }));
    expect(on).toHaveBeenCalledWith('pl');
  });
});

describe('ImagePicker', () => {
  const choices = [{ id: 'k', src: '/k.jpg', label: 'Кухня' }];
  it('вариант приложения, «без картинки» и «как было» — разные исходы', () => {
    const on = vi.fn();
    render(<ImagePicker choices={choices} value={null} onChange={on} />);
    fireEvent.click(screen.getByRole('button', { name: 'Кухня' }));
    expect(on).toHaveBeenLastCalledWith({ kind: 'src', src: '/k.jpg' });
    fireEvent.click(screen.getByRole('button', { name: /без картинки/ }));
    expect(on).toHaveBeenLastCalledWith({ kind: 'none' });
    fireEvent.click(screen.getByRole('button', { name: /как было/ }));
    expect(on).toHaveBeenLastCalledWith({ kind: 'default' });
  });
  it('своя картинка: не тот тип — отказ словами, onChange не зовётся', async () => {
    const on = vi.fn();
    const { container } = render(<ImagePicker choices={choices} value={null} onChange={on} />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(on).not.toHaveBeenCalled();
  });
});

describe('LiveHeader — шапка паспорта «живой объект»', () => {
  it('имя, статус словами с тоном, возраст доклада, строка сведений и действия', () => {
    const { container } = render(<LiveHeader title="Кабинет · колонка" status={{ tone: 'warn', text: 'молчит' }} ageSec={4 * 3600}
      meta="speaker · комната «Кабинет»" actions={<button>Пинг</button>} />);
    expect(screen.getByRole('heading', { name: 'Кабинет · колонка' })).toBeTruthy();
    expect(screen.getByText(/молчит/).closest('.sk-livehead__status')!.className).toMatch(/is-warn/);
    expect(screen.getByText(/4 ч назад/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Пинг' })).toBeTruthy();
    expect(container.querySelector('.sk-livehead__meta')!.textContent).toContain('Кабинет');
  });
});

describe('TileGallery — плитки с фильтрами и группами', () => {
  const items = [
    { id: '1', kind: 'temp', groups: { room: 'Кухня', floor: '1 этаж' }, node: <i>t1</i> },
    { id: '2', kind: 'hum', groups: { room: 'Кухня', floor: '1 этаж' }, node: <i>h1</i> },
    { id: '3', kind: 'temp', groups: { room: 'Спальня', floor: '2 этаж' }, node: <i>t2</i> },
  ];
  const kinds = [{ id: 'temp', label: 'Температура' }, { id: 'hum', label: 'Влажность' }];
  const groupings = [{ id: 'room', label: 'комнаты' }, { id: 'floor', label: 'этажи' }];
  it('группы по выбранному разрезу, в порядке появления', () => {
    expect(galleryGroups(items, 'room').map((g) => [g.key, g.items.length])).toEqual([['Кухня', 2], ['Спальня', 1]]);
  });
  it('чипы видов с числом; чип включает фильтр; разрез переключается; выбор — в адресе', () => {
    render(<TileGallery items={items} kinds={kinds} groupings={groupings} urlKey="g" />);
    expect(screen.getByRole('button', { name: /Температура 2/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Влажность 1/ }));
    expect(screen.queryByText('t1')).toBeNull();
    expect(screen.getByText('h1')).toBeTruthy();
    expect(window.location.search).toContain('g.kinds=hum');
    fireEvent.click(screen.getByRole('button', { name: 'этажи' }));
    expect(screen.getByText('1 этаж')).toBeTruthy();
  });
  it('под фильтр ничего не попало — словами', () => {
    render(<TileGallery items={[]} kinds={kinds} groupings={groupings} urlKey="g2" />);
    expect(screen.getByText(/ничего не попало|пусто/i)).toBeTruthy();
  });
});

describe('HiddenNote — «часть скрыта правами»', () => {
  it('есть скрытые — словами с числом; нет — ничего', () => {
    const { rerender, container } = render(<HiddenNote hidden={4} />);
    expect(screen.getByRole('note').textContent).toMatch(/4/);
    rerender(<HiddenNote hidden={0} />);
    expect(container.textContent).toBe('');
  });
});
