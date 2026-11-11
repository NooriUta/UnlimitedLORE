// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-FIELD-EDITORS — редакторы по видам полей.
//
// Решение D-2026-LORE-MODEL-FIELD-KINDS и уточнения соседей 11.11:
//   • реестр «вид поля → редактор» — в kit (форма), словарь видов и права —
//     от приложения (K-14);
//   • «пусто ≠ ноль ≠ не задано»: у number пустое поле — не задано (null), а не
//     0; у boolean ТРИ состояния; date — без зоны, datetime — с зоной;
//   • неизвестный вид — только чтение: иначе редактор молча съест значение;
//   • определение поля совместимо с RefFieldDef сессии «MD и супертеги»
//     (key, label, required: block|warn, options) — её карточка «Новый»
//     перейдёт на эти редакторы без переделки контракта.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldEditor, fieldKindOf, parseNumberInput, toZonedIso, type FieldEditorDef } from '../index';

const mount = (def: FieldEditorDef, value: unknown, extra: Partial<Parameters<typeof FieldEditor>[0]> = {}) => {
  const onChange = vi.fn();
  render(<FieldEditor def={def} value={value} onChange={onChange} {...extra} />);
  return onChange;
};

describe('чистые правила видов', () => {
  it('число: пусто — не задано (null), «0» — ноль, запятая — десятичная, мусор — отказ', () => {
    expect(parseNumberInput('')).toEqual({ ok: true, value: null });
    expect(parseNumberInput('0')).toEqual({ ok: true, value: 0 });
    expect(parseNumberInput('1,5')).toEqual({ ok: true, value: 1.5 });
    expect(parseNumberInput('абв')).toEqual({ ok: false });
  });

  it('дата-время с зоной: локальное время + смещение → ISO со смещением, а не «без зоны»', () => {
    expect(toZonedIso('2026-11-11T10:30', 180)).toBe('2026-11-11T10:30:00+03:00');
    expect(toZonedIso('2026-11-11T10:30', -330)).toBe('2026-11-11T10:30:00-05:30');
    expect(toZonedIso('', 180)).toBeNull();
  });

  it('совместимость с RefFieldDef: вида нет — по вариантам enum, иначе text', () => {
    expect(fieldKindOf({ key: 'a', label: 'А', options: ['x'] })).toBe('enum');
    expect(fieldKindOf({ key: 'a', label: 'А' })).toBe('text');
    expect(fieldKindOf({ key: 'a', label: 'А', kind: 'date' })).toBe('date');
  });
});

describe('FieldEditor · виды', () => {
  it('text: подпись связана с полем, ввод уходит наружу', () => {
    const on = mount({ key: 'title', label: 'Название', kind: 'text' }, 'было');
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'стало' } });
    expect(on).toHaveBeenCalledWith('стало');
  });

  it('number: пусто → null, «1,5» → 1.5, мусор не уходит и назван словами', () => {
    const on = mount({ key: 'effort', label: 'Оценка', kind: 'number' }, 2);
    const input = screen.getByLabelText('Оценка');
    fireEvent.change(input, { target: { value: '' } });
    expect(on).toHaveBeenLastCalledWith(null);
    fireEvent.change(input, { target: { value: '1,5' } });
    expect(on).toHaveBeenLastCalledWith(1.5);
    on.mockClear();
    fireEvent.change(input, { target: { value: 'абв' } });
    expect(on).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/не число/);
  });

  it('boolean: три состояния — «Да», «Нет», «Не задано»; null — это «Не задано», а не «Нет»', () => {
    const on = mount({ key: 'flag', label: 'Флаг', kind: 'boolean' }, null);
    const group = screen.getByRole('radiogroup', { name: 'Флаг' });
    expect((screen.getByRole('radio', { name: 'Не задано' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Нет' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: 'Да' }));
    expect(on).toHaveBeenLastCalledWith(true);
    expect(group).toBeTruthy();
  });

  it('date — без зоны, time — время, datetime — с зоной и подписью зоны', () => {
    const onDate = mount({ key: 'd', label: 'Дата', kind: 'date' }, '2026-11-10');
    const date = screen.getByLabelText('Дата') as HTMLInputElement;
    expect(date.type).toBe('date');
    fireEvent.change(date, { target: { value: '2026-11-11' } });
    expect(onDate).toHaveBeenLastCalledWith('2026-11-11');
    expect((screen.getAllByLabelText(/Дата/)[0] as HTMLInputElement).type).toBe('date');
  });

  it('time — поле времени', () => {
    mount({ key: 't', label: 'Время', kind: 'time' }, '09:00');
    expect((screen.getByLabelText('Время') as HTMLInputElement).type).toBe('time');
  });

  it('datetime — местное время с названной зоной, наружу ISO со смещением', () => {
    const on = mount({ key: 'at', label: 'Когда', kind: 'datetime' }, null, { tzOffsetMinutes: 180 });
    const input = screen.getByLabelText('Когда') as HTMLInputElement;
    expect(input.type).toBe('datetime-local');
    expect(screen.getByText('UTC+03:00')).toBeTruthy();
    fireEvent.change(input, { target: { value: '2026-11-11T10:30' } });
    expect(on).toHaveBeenLastCalledWith('2026-11-11T10:30:00+03:00');
  });

  it('enum: «— не задано —» и варианты; значение вне списка не пропадает, а названо', () => {
    const on = mount({ key: 'prio', label: 'Приоритет', kind: 'enum', options: ['P1', 'P2'] }, 'P9');
    const sel = screen.getByLabelText('Приоритет') as HTMLSelectElement;
    expect([...sel.options].map(o => o.textContent)).toEqual(['— не задано —', 'P1', 'P2', '«P9» нет в списке']);
    expect(sel.value).toBe('P9');
    fireEvent.change(sel, { target: { value: 'P2' } });
    expect(on).toHaveBeenLastCalledWith('P2');
    fireEvent.change(sel, { target: { value: '' } });
    expect(on).toHaveBeenLastCalledWith(null);
  });

  it('неизвестный вид — только чтение с названной причиной, поля ввода нет', () => {
    mount({ key: 'g', label: 'Гео', kind: 'geo' }, '55.7,37.6');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('55.7,37.6')).toBeTruthy();
    expect(screen.getByText(/вид поля «geo» не поддерживается — только чтение/)).toBeTruthy();
  });

  it('editable: false — только чтение, даже у знакомого вида', () => {
    mount({ key: 'title', label: 'Название', kind: 'text', editable: false }, 'текст');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('текст')).toBeTruthy();
  });
});

describe('FieldEditor · обязательность (D-2026-LORE-RECORD-FIELD-REQUIRED)', () => {
  it('block: пустое при показе обязательных — aria-invalid и слова «обязательное поле»', () => {
    mount({ key: 'title', label: 'Название', kind: 'text', required: 'block' }, '', { showRequired: true });
    expect(screen.getByLabelText(/Название/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Обязательное поле')).toBeTruthy();
  });

  it('warn: пустое — мягкая подсказка, без aria-invalid', () => {
    mount({ key: 'goal', label: 'Цель', kind: 'text', required: 'warn' }, '', { showRequired: true });
    expect(screen.getByLabelText(/Цель/).getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByText('Желательно заполнить')).toBeTruthy();
  });

  it('положительный контроль: заполнено или показ обязательных выключен — подсказки нет', () => {
    mount({ key: 'title', label: 'Название', kind: 'text', required: 'block' }, 'есть', { showRequired: true });
    expect(screen.queryByText('Обязательное поле')).toBeNull();
  });

  it('у числа 0 — это заполнено, а не пусто', () => {
    mount({ key: 'n', label: 'Число', kind: 'number', required: 'block' }, 0, { showRequired: true });
    expect(screen.queryByText('Обязательное поле')).toBeNull();
  });
});

// Вторая порция: несколько значений (multi), порядок (ordered), MD через слот.
describe('FieldEditor · несколько значений и порядок', () => {
  it('multi: флажки по вариантам; отметка добавляет, снятие убирает; «ничего» — [], а не null', () => {
    const on = mount({ key: 'tags', label: 'Теги', kind: 'enum', options: ['a', 'b', 'c'], multi: true }, ['a']);
    const group = screen.getByRole('group', { name: 'Теги' });
    expect((screen.getByRole('checkbox', { name: 'a' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'b' }));
    expect(on).toHaveBeenLastCalledWith(['a', 'b']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'a' }));
    expect(on).toHaveBeenLastCalledWith([]);
    expect(group).toBeTruthy();
  });

  it('multi: значения вне списка не пропадают — видны и отмечены', () => {
    mount({ key: 'tags', label: 'Теги', kind: 'enum', options: ['a'], multi: true }, ['a', 'zz']);
    expect((screen.getByRole('checkbox', { name: '«zz» нет в списке' }) as HTMLInputElement).checked).toBe(true);
  });

  it('ordered: выбранные идут списком с кнопками «выше / ниже», порядок уходит наружу', () => {
    const on = mount({ key: 'deps', label: 'Порядок', kind: 'enum', options: ['a', 'b', 'c'], multi: true, ordered: true }, ['a', 'c']);
    fireEvent.click(screen.getByRole('button', { name: 'Ниже: a' }));
    expect(on).toHaveBeenLastCalledWith(['c', 'a']);
    expect((screen.getByRole('button', { name: 'Выше: a' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('FieldEditor · MD через слот', () => {
  it('md без переданного редактора — только чтение с причиной (тяжёлый редактор в основной пакет не тянем)', () => {
    mount({ key: 'body', label: 'Текст', kind: 'md' }, '**жирный**');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/редактор MD не подключён/)).toBeTruthy();
  });

  it('md со слотом — рисуется переданный редактор, изменение уходит наружу', () => {
    const on = vi.fn();
    render(<FieldEditor def={{ key: 'body', label: 'Текст', kind: 'md' }} value="было" onChange={on}
      mdEditor={({ value, onChange, label }) => <textarea aria-label={label} value={value} onChange={e => onChange(e.target.value)} />} />);
    fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'стало' } });
    expect(on).toHaveBeenCalledWith('стало');
  });
});

// Третья порция: ссылка на запись. Выбор записи — RefSearchList сессии «MD и
// супертеги»; поиск по типам знает только приложение (K-14), поэтому редактор
// приходит слотом, как MD. Значение — { id, type, title } (RefItem).
describe('FieldEditor · ссылка на запись (ref) через слот', () => {
  const ref = { id: 'ADR-LORE-049', type: 'adr', title: 'Колонки по модели' };

  it('ref без слота — только чтение: видно, на что ссылка, и названа причина', () => {
    mount({ key: 'adr', label: 'ADR', kind: 'ref' }, ref);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Колонки по модели · ADR-LORE-049')).toBeTruthy();
    expect(screen.getByText(/выбор записи не подключён/)).toBeTruthy();
  });

  it('ref со слотом — рисуется переданный выбор; выбранное уходит наружу, «убрать» — null', () => {
    const on = vi.fn();
    render(<FieldEditor def={{ key: 'adr', label: 'ADR', kind: 'ref', refTypes: ['adr'] }} value={ref} onChange={on}
      refEditor={({ value, onChange, label, refTypes }) => (
        <button type="button" aria-label={label} data-types={refTypes?.join(',')} onClick={() => onChange(value ? null : ref)}>pick</button>
      )} />);
    const btn = screen.getByRole('button', { name: 'ADR' });
    expect(btn.getAttribute('data-types')).toBe('adr');
    fireEvent.click(btn);
    expect(on).toHaveBeenCalledWith(null);
  });

  it('ref: пустая ссылка при показе обязательных — «Обязательное поле»', () => {
    mount({ key: 'adr', label: 'ADR', kind: 'ref', required: 'block' }, null, {
      showRequired: true, refEditor: () => <span>pick</span>,
    });
    expect(screen.getByText('Обязательное поле')).toBeTruthy();
  });
});
