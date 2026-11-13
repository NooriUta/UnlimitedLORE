// @vitest-environment jsdom
// Мини-окно ссылки ВНУТРИ TipTapField (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, ADR-LORE-050).
// Набор «[[тип:» или «#тип» → окно над кареткой, фокус остаётся в тексте; выбор кладёт
// в тело [[тип:ID]] атомом (а не текстом: текст сериализатор экранирует в «\[\[», и ссылка
// пропала бы). Без пропа refs поле ведёт себя как раньше; «@» при mentionItems — по-прежнему
// упоминание людей (развилка «@» ждёт решения владелицы, работающее не трогаем).
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';

// Заглушка раскладки jsdom (getClientRects у Range/Text) — общая, в src/test/setup.ts.

import { TipTapField } from './TipTapField';
import type { TipTapRefSource } from './TipTapField';

const items = [
  { id: 'ADR-1', type: 'adr', title: 'Первое' },
  { id: 'ADR-2', type: 'adr', title: 'Второе' },
];
const source = (over: Partial<TipTapRefSource> = {}): TipTapRefSource => ({
  types: { adr: 'adr', task: 'task' },
  typeLabels: { adr: 'ADR', task: 'задача' },
  search: vi.fn(async (_q: string, type: string | null) => items.filter(i => !type || i.type === type)),
  ...over,
});

async function mount(props: Partial<Parameters<typeof TipTapField>[0]> = {}) {
  const onChange = vi.fn();
  const r = render(<TipTapField value="" onChange={onChange} ariaLabel="Тело" {...props} />);
  await waitFor(() => expect(r.container.querySelector('.ProseMirror')).toBeTruthy());
  const editor = (r.container.querySelector('.ProseMirror') as unknown as { editor: Editor }).editor;
  // Фокус ставим явно: отложенный focus() у TipTap в jsdom срабатывает не всегда, а проверяем
  // мы своё свойство — окно не ЗАБИРАЕТ фокус, который у текста уже есть.
  const type = (s: string) => act(() => { editor.view.dom.focus(); editor.chain().focus('end').insertContent(s).run(); });
  const key = (k: string) => act(() => {
    editor.view.someProp('handleKeyDown', f => f(editor.view, new KeyboardEvent('keydown', { key: k })));
  });
  const md = () => onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string | undefined;
  // focus() у TipTap отложен на кадр: дать ему сработать ДО размонтирования, иначе он
  // сработает уже в следующем тесте на удалённом поле и уведёт фокус в body.
  const settle = () => act(async () => { await new Promise(r => setTimeout(r, 40)); });
  return { ...r, editor, type, key, md, onChange, settle };
}

describe('TipTapField + refs — окно ссылки', () => {
  it('«[[adr:» открывает окно с сужением; щелчок — в теле [[adr:ID]], без экранирования', async () => {
    const refs = source();
    const f = await mount({ refs });
    await f.type('См. [[adr:В');
    await waitFor(() => expect(screen.getByText('ADR-2')).toBeTruthy());
    expect(refs.search).toHaveBeenLastCalledWith('В', 'adr');
    fireEvent.click(screen.getByText('ADR-2'));
    await waitFor(() => expect(f.md()).toContain('См. [[adr:ADR-2]]'));
    expect(f.md()).not.toContain('\\[');
    expect(screen.queryByText('ADR-1')).toBeNull();
    await f.settle();
  });

  it('стрелка и Enter из редактора выбирают пункт, фокус не уходил из текста', async () => {
    const f = await mount({ refs: source() });
    await f.type('текст #adr В');
    await waitFor(() => expect(screen.getByText('ADR-1')).toBeTruthy());
    const at = document.activeElement as HTMLElement | null;
    expect(at?.classList.contains('ProseMirror')).toBe(true);
    expect(at?.closest('.sk-ref')).toBeNull();
    await f.key('ArrowDown');
    await f.key('Enter');
    await waitFor(() => expect(f.md()).toContain('[[adr:ADR-2]]'));
    await f.settle();
  });

  it('Esc закрывает окно, набранное остаётся текстом', async () => {
    const f = await mount({ refs: source() });
    await f.type('см. [[мини');
    await waitFor(() => expect(screen.getByText('ADR-1')).toBeTruthy());
    await f.key('Escape');
    await waitFor(() => expect(screen.queryByText('ADR-1')).toBeNull());
    expect(f.editor.getText()).toContain('[[мини');
  });

  it('поиск упал — окно говорит «не смогли загрузить», а не пустой список', async () => {
    const f = await mount({ refs: source({ search: vi.fn(async () => { throw new Error('503'); }) }) });
    await f.type('см. [[x');
    await waitFor(() => expect(screen.getByText(/Не смогли загрузить/).textContent).toContain('503'));
  });

  it('внутри кода окно не открывается', async () => {
    const refs = source();
    const f = await mount({ refs });
    await act(() => { f.editor.chain().focus('end').toggleCode().insertContent('[[adr:').run(); });
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText('ADR-1')).toBeNull();
    expect(refs.search).not.toHaveBeenCalled();
  });

  it('без refs — «[[» обычный текст, окна нет (поле как раньше)', async () => {
    const f = await mount();
    await f.type('см. [[adr:');
    await new Promise(r => setTimeout(r, 30));
    expect(document.querySelector('.sk-ref')).toBeNull();
  });

  it('«@» при mentionItems — по-прежнему упоминание людей, окно ссылки не перехватывает', async () => {
    const refs = source();
    const f = await mount({ refs, mentionItems: [{ id: 'u1', label: 'Аня' }] });
    await f.type('привет @');
    await new Promise(r => setTimeout(r, 30));
    expect(document.querySelector('.sk-ref')).toBeNull();
    expect(refs.search).not.toHaveBeenCalled();
  });
});

describe('TipTapField + refs — пустой запрос', () => {
  it('«[[adr:» без слов — «введите слова поиска», поиск не вызывается (не спрашивали ≠ не нашлось)', async () => {
    const refs = source();
    const f = await mount({ refs });
    await f.type('см. [[adr:');
    await waitFor(() => expect(screen.getByText(/Введите слова поиска/)).toBeTruthy());
    expect(screen.queryByText(/Не нашлось/)).toBeNull();
    expect(refs.search).not.toHaveBeenCalled();
  });
  it('порог задаёт приложение: minQuery=2 — по одной букве не ищем', async () => {
    const refs = source({ minQuery: 2 });
    const f = await mount({ refs });
    await f.type('см. [[В');
    await waitFor(() => expect(screen.getByText(/Введите слова поиска/)).toBeTruthy());
    expect(refs.search).not.toHaveBeenCalled();
    await f.type('т');
    await waitFor(() => expect(refs.search).toHaveBeenLastCalledWith('Вт', null));
  });
});

describe('MdInlineEdit пробрасывает refs в редактор', () => {
  it('правка тела записи: «[[В» открывает окно ссылки', async () => {
    const { MdInlineEdit } = await import('./MdInlineEdit');
    const refs = source();
    const { container } = render(<MdInlineEdit value="текст" label="Описание" onSave={() => {}} refs={refs} />);
    fireEvent.click(screen.getByRole('button', { name: /Править «Описание»/ }));
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy());
    const editor = (container.querySelector('.ProseMirror') as unknown as { editor: Editor }).editor;
    await act(() => { editor.view.dom.focus(); editor.chain().focus('end').insertContent(' [[В').run(); });
    await waitFor(() => expect(container.querySelector('.sk-ref')).toBeTruthy());
    expect(refs.search).toHaveBeenLastCalledWith('В', null);
  });
});
