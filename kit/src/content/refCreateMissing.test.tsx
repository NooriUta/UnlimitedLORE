// @vitest-environment jsdom
// MD-WINDOW §3a, кадры 16–21 раскадровки (D-2026-LORE-MD-REF-PASTE-CHECK): у красной ссылки —
// «Завести»; заведение — под ТЕМ ЖЕ ID (тип и ID из ссылки, поля из ID приложение подставляет и
// они не правятся); после заведения ссылка зелёная и счётчик «Дозавести» уменьшается.
// «Не сейчас» сворачивает полосу в «Дозавести (N)» — меню всех красных ссылок текста.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TipTapField, type TipTapRefSource } from './TipTapField';

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
const zeroRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
for (const proto of [Range.prototype, Element.prototype, Text.prototype as unknown as Element]) {
  const p = proto as unknown as { getClientRects?: unknown; getBoundingClientRect?: unknown };
  if (typeof p.getClientRects !== 'function') p.getClientRects = noRects;
  if (typeof p.getBoundingClientRect !== 'function') p.getBoundingClientRect = zeroRect;
}

const forms = [{ type: 'spec', re: /SPEC-[A-Z0-9]+(?:-[A-Z0-9]+)*/ }];

function src(over: Partial<TipTapRefSource> = {}): TipTapRefSource {
  return {
    types: { spec: 'spec' }, typeLabels: { spec: 'Спека' }, search: async () => [], forms,
    exists: async () => ({ 'SPEC-X': false, 'SPEC-Y': false }),
    createSpec: () => ({ fields: [{ key: 'code', label: 'Код', required: 'block' }, { key: 'title', label: 'Название', required: 'block' }] }),
    presetFor: (id: string) => ({ code: id }),
    onCreate: vi.fn(async (type: string, v: Record<string, string>) => ({ ok: true as const, item: { id: v.code, type, title: v.title } })),
    ...over,
  };
}

const strip = () => screen.getByTestId('kit-ref-missing');

describe('MD-WINDOW · «Завести» / «Дозавести (N)» у красных ссылок', () => {
  it('полоса перечисляет красные ссылки, у каждой — «Завести»', async () => {
    render(<TipTapField value="[[spec:SPEC-X]] [[spec:SPEC-Y]]" onChange={() => {}} refs={src()} />);
    await screen.findByTestId('kit-ref-missing');
    expect(within(strip()).getAllByRole('button', { name: /^Завести/ })).toHaveLength(2);
  });

  it('«Завести» — карточка под ТЕМ ЖЕ ID: код подставлен и не правится; заполнили название — ссылка зелёная', async () => {
    const s = src();
    const { container } = render(<TipTapField value="[[spec:SPEC-X]] [[spec:SPEC-Y]]" onChange={() => {}} refs={s} />);
    await screen.findByTestId('kit-ref-missing');
    fireEvent.click(within(strip()).getByRole('button', { name: 'Завести SPEC-X' }));
    const card = await screen.findByTestId('kit-ref-create');
    const code = within(card).getByLabelText(/Код/) as HTMLInputElement;
    expect(code.value).toBe('SPEC-X');
    expect(code.readOnly).toBe(true);
    fireEvent.change(within(card).getByLabelText(/Название/), { target: { value: 'Новая спека' } });
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: /Создать/ })); });
    expect(s.onCreate).toHaveBeenCalledWith('spec', { code: 'SPEC-X', title: 'Новая спека' });
    await waitFor(() => expect(container.querySelector('[data-raw="[[spec:SPEC-X]]"]')?.getAttribute('data-ref-state')).toBe('ok'));
    expect(screen.queryByTestId('kit-ref-create')).toBeNull();
    expect(within(strip()).getAllByRole('button', { name: /^Завести/ })).toHaveLength(1);
  });

  it('отказ сервера — причина словами, ссылка остаётся красной, карточка открыта', async () => {
    const s = src({ onCreate: vi.fn(async () => ({ ok: false as const, reason: 'Запись SPEC-X уже есть' })) });
    const { container } = render(<TipTapField value="[[spec:SPEC-X]]" onChange={() => {}} refs={s} />);
    await screen.findByTestId('kit-ref-missing');
    fireEvent.click(within(strip()).getByRole('button', { name: 'Завести SPEC-X' }));
    const card = await screen.findByTestId('kit-ref-create');
    fireEvent.change(within(card).getByLabelText(/Название/), { target: { value: 'X' } });
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: /Создать/ })); });
    expect(within(card).getByRole('alert').textContent).toMatch(/уже есть/);
    expect(container.querySelector('[data-raw="[[spec:SPEC-X]]"]')?.getAttribute('data-ref-state')).toBe('missing');
  });

  it('«Не сейчас» сворачивает полосу в «Дозавести (N)»; он открывает тот же список', async () => {
    render(<TipTapField value="[[spec:SPEC-X]] [[spec:SPEC-Y]]" onChange={() => {}} refs={src()} />);
    await screen.findByTestId('kit-ref-missing');
    act(() => { screen.getByRole('button', { name: 'Не сейчас' }).click(); });
    expect(screen.queryByTestId('kit-ref-missing')).toBeNull();
    const more = screen.getByRole('button', { name: 'Дозавести (2)' });
    act(() => { more.click(); });
    expect(within(strip()).getAllByRole('button', { name: /^Завести/ })).toHaveLength(2);
  });

  it('заводить приложение не умеет (нет createSpec/onCreate) — кнопок «Завести» нет, полоса как прежде', async () => {
    render(<TipTapField value="[[spec:SPEC-X]]" onChange={() => {}} refs={src({ createSpec: undefined, onCreate: undefined })} />);
    await screen.findByTestId('kit-ref-missing');
    expect(within(strip()).queryByRole('button', { name: /^Завести/ })).toBeNull();
  });
});
