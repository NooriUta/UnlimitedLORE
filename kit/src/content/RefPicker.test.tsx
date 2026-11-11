// @vitest-environment jsdom
// Мини-окно ссылки (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, spec:SPEC-LORE-MD-INLINE-REF §3).
// Две карточки: «Существующий» (поиск → выбор) и «Новый» (форма, обязательные поля).
// Честные состояния различаются словами: не нашлось ≠ не загрузилось ≠ нет прав ≠ тип не знаем.
// Kit не знает предметных имён: типы, их подписи, поля и поиск даёт приложение.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { RefPicker, checkRequired } from './RefPicker';
import type { RefPickerHandle, RefPickerProps, RefFieldDef } from './RefPicker';

const typeLabels = { adr: 'ADR', task: 'задача' };
const items = [
  { id: 'ADR-1', type: 'adr', title: 'Первое' },
  { id: 'ADR-2', type: 'adr', title: 'Второе' },
];
const taskFields: RefFieldDef[] = [
  { key: 'title', label: 'Название', required: 'block' },
  { key: 'sprint', label: 'Спринт', required: 'block', options: ['S1', 'S2'] },
  { key: 'effort', label: 'Оценка', required: 'warn' },
  { key: 'cls', label: 'Класс', more: true },
];

function setup(over: Partial<RefPickerProps> = {}) {
  const props: RefPickerProps = {
    trigger: { trigger: 'at', type: null, query: 'пе', start: 0 },
    typeLabels,
    search: { state: 'ok', items },
    onPick: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const ref = createRef<RefPickerHandle>();
  render(<RefPicker ref={ref} {...props} />);
  return { props, ref };
}

describe('checkRequired — две ступени обязательности', () => {
  it('block пусто — блокирует, warn пусто — только предупреждает', () => {
    expect(checkRequired(taskFields, { effort: '' })).toEqual({ blocked: ['Название', 'Спринт'], warned: ['Оценка'] });
    expect(checkRequired(taskFields, { title: 'x', sprint: 'S1' })).toEqual({ blocked: [], warned: ['Оценка'] });
  });
  it('пробелы — это пусто', () => {
    expect(checkRequired(taskFields, { title: '  ', sprint: 'S1', effort: '1' }).blocked).toEqual(['Название']);
  });
});

describe('RefPicker — открывается посреди набора', () => {
  it('фокус остаётся в редакторе: окно его не забирает', () => {
    const ed = document.createElement('textarea');
    document.body.appendChild(ed);
    ed.focus();
    setup();
    expect(document.activeElement).toBe(ed);
    ed.remove();
  });
});

describe('RefPicker — карточка «Существующий»', () => {
  it('список найденного; щелчок — выбор', () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('ADR-2'));
    expect(props.onPick).toHaveBeenCalledWith(items[1]);
  });
  it('стрелки и Enter приходят из редактора (фокус там) — через handleKey', () => {
    const { props, ref } = setup();
    let used = false;
    act(() => { used = ref.current!.handleKey('ArrowDown'); });
    expect(used).toBe(true);
    act(() => { ref.current!.handleKey('Enter'); });
    expect(props.onPick).toHaveBeenCalledWith(items[1]);
  });
  it('Esc из редактора закрывает', () => {
    const { props, ref } = setup();
    act(() => { ref.current!.handleKey('Escape'); });
    expect(props.onClose).toHaveBeenCalled();
  });
  it('не нашлось — словами, с запросом, и это не ошибка', () => {
    setup({ search: { state: 'ok', items: [] } });
    expect(screen.getByText(/Не нашлось/).textContent).toContain('пе');
    expect(screen.queryByText(/Не смогли/)).toBeNull();
  });
  it('не загрузилось — причина словами и «Повторить», а не пустой список', () => {
    const onRetry = vi.fn();
    setup({ search: { state: 'error', reason: '503' }, onRetry });
    expect(screen.getByText(/Не смогли загрузить/).textContent).toContain('503');
    expect(screen.queryByText(/Не нашлось/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(onRetry).toHaveBeenCalled();
  });
  it('тип не знаем — называет слово и перечисляет известные', () => {
    setup({ trigger: { trigger: 'hash', type: null, unknownType: 'foo', query: '', start: 0 } });
    const msg = screen.getByText(/не знаем/).textContent ?? '';
    expect(msg).toContain('foo');
    expect(msg).toContain('ADR');
  });
  it('сужение по типу видно в шапке', () => {
    setup({ trigger: { trigger: 'hash', type: 'adr', query: '', start: 0 } });
    expect(screen.getByTestId('ref-head').textContent).toContain('ADR');
  });
});

describe('RefPicker — карточка «Новый»', () => {
  const newSetup = (over: Partial<RefPickerProps> = {}) => setup({
    trigger: { trigger: 'hash', type: 'task', query: 'Мини', start: 0 },
    createSpec: () => ({ fields: taskFields }),
    ...over,
  });
  it('сначала обязательные, остальные — по «ещё поля»; запрос — в название', () => {
    newSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Новый' }));
    expect((screen.getByLabelText(/Название/) as HTMLInputElement).value).toBe('Мини');
    expect(screen.queryByLabelText(/Класс/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ещё поля/ }));
    expect(screen.getByLabelText(/Класс/)).toBeTruthy();
  });
  it('block пусто — отказ называет поля, запрос не уходит', () => {
    const onCreate = vi.fn();
    newSetup({ trigger: { trigger: 'hash', type: 'task', query: '', start: 0 }, onCreate });
    fireEvent.click(screen.getByRole('button', { name: 'Новый' }));
    fireEvent.click(screen.getByRole('button', { name: /Создать/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/Название, Спринт/);
    expect(onCreate).not.toHaveBeenCalled();
  });
  it('block пусто при заполненных warn — всё равно отказ, повторный щелчок тоже не создаёт', () => {
    const onCreate = vi.fn();
    newSetup({ trigger: { trigger: 'hash', type: 'task', query: '', start: 0 }, onCreate });
    fireEvent.click(screen.getByRole('button', { name: 'Новый' }));
    fireEvent.change(screen.getByLabelText(/Оценка/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Создать/ }));
    fireEvent.click(screen.getByRole('button', { name: /Создать/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/Название, Спринт/);
    expect(onCreate).not.toHaveBeenCalled();
  });
  it('warn пусто — предупреждение, второй щелчок создаёт и выбирает созданное', async () => {
    const made = { id: 'S1/NEW-1', type: 'task', title: 'Мини' };
    const onCreate = vi.fn(async () => ({ ok: true as const, item: made }));
    const { props } = newSetup({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: 'Новый' }));
    fireEvent.change(screen.getByLabelText(/Спринт/), { target: { value: 'S1' } });
    fireEvent.click(screen.getByRole('button', { name: /Создать/ }));
    expect(screen.getByRole('status').textContent).toMatch(/Оценка/);
    expect(onCreate).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Создать всё равно/ })); });
    expect(onCreate).toHaveBeenCalledWith('task', { title: 'Мини', sprint: 'S1' });
    expect(props.onPick).toHaveBeenCalledWith(made);
  });
  it('сервер отказал — причина словами, окно не закрывается', async () => {
    const onCreate = vi.fn(async () => ({ ok: false as const, reason: 'такой ID уже есть' }));
    const { props } = newSetup({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: 'Новый' }));
    fireEvent.change(screen.getByLabelText(/Спринт/), { target: { value: 'S1' } });
    fireEvent.change(screen.getByLabelText(/Оценка/), { target: { value: '1' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Создать/ })); });
    expect(screen.getByRole('alert').textContent).toContain('такой ID уже есть');
    expect(props.onPick).not.toHaveBeenCalled();
  });
  it('нет прав завести тип — сказано, вставка существующего доступна', () => {
    newSetup({ createSpec: () => ({ denied: 'роль не может заводить задачи' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Новый' }));
    expect(screen.getByText(/Нет прав/).textContent).toContain('роль не может заводить задачи');
    fireEvent.click(screen.getByRole('button', { name: 'Существующий' }));
    expect(screen.getByText('ADR-1')).toBeTruthy();
  });
  it('без createSpec карточки «Новый» нет вовсе', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Новый' })).toBeNull();
  });
});
