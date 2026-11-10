// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-06 — правка MD на месте, встроенная в режим
// чтения: текст читается MartProse, правка открывается ТОЛЬКО кнопкой ✎
// (касание по тексту на телефоне — прокрутка и выделение, а не случайный
// вход в правку), внутри — TipTap.
// Вид правки с 10.11.2026 выбирается В САМОМ редакторе («</> md» — исходник,
// «◫» — вместе): переключателя «код / превью / рядом» над полем нет, правило
// и его повод — в mdOneButton.test.tsx.
// Страховка — круг S5-07: где TipTap исказил бы текст, визуальная правка
// честно закрыта.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axeViolations } from '../test/axe';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import { KitLangProvider } from '../index';
import { MdInlineEdit } from './MdInlineEdit';

const pen = () => screen.getByRole('button', { name: /Править «Описание»/ });
/** Кнопка исходника в ряду редактора — ею же правка идёт «в коде». */
const mdBtn = () => screen.getByRole('button', { name: 'режим markdown-источника' });
const togetherBtn = () => screen.getByRole('button', { name: /показывать вместе/ });
/** Открытая правка: признак — ряд кнопок редактора. */
const editorBar = () => document.querySelector('.sk-md__toolbar');
const waitEditor = () => waitFor(() => expect(editorBar()).toBeTruthy());

describe('S5-06 · MdInlineEdit — чтение', () => {
  it('рисует markdown через MartProse и кнопку ✎; касание по тексту правку НЕ открывает', () => {
    const { container } = render(<MdInlineEdit label="Описание" value={'## Тело\n\n**жир**'} onSave={() => {}} />);
    expect(container.querySelector('.sk-prose h2')?.textContent).toBe('Тело');
    fireEvent.click(container.querySelector('.sk-prose')!);
    fireEvent.pointerUp(container.querySelector('.sk-prose')!);
    fireEvent.doubleClick(container.querySelector('.sk-prose')!);
    expect(editorBar()).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(pen()).toBeTruthy();
  });

  it('без onSave — только чтение: кнопки ✎ нет вовсе', () => {
    render(<MdInlineEdit label="Описание" value="текст" />);
    expect(screen.queryByRole('button', { name: /Править/ })).toBeNull();
  });

  it('пустое тело — честная пустота с текстом, а не пустой блок; ✎ доступна', () => {
    const { container } = render(<MdInlineEdit label="Описание" value="" onSave={() => {}} />);
    expect(container.textContent).toContain('Текста нет');
    expect(pen()).toBeTruthy();
  });

  it('axe чист в чтении и в правке', async () => {
    const { container } = render(<MdInlineEdit label="Описание" value="текст" onSave={() => {}} />);
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(pen());
    await waitEditor();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('S5-06 · MdInlineEdit — правка', () => {
  it('✎ открывает правку: по умолчанию визуальная (TipTap), исходник — кнопкой md', async () => {
    const { container } = render(<MdInlineEdit label="Описание" value="**жир**" onSave={() => {}} />);
    fireEvent.click(pen());
    await waitEditor();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(mdBtn().getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(container.querySelector('.sk-md .ProseMirror strong')?.textContent).toBe('жир'));
  });

  it('«md» — исходник markdown в textarea; «вместе» — исходник и живой рендер одновременно', async () => {
    const { container } = render(<MdInlineEdit label="Описание" value="**жир**" onSave={() => {}} />);
    fireEvent.click(pen());
    await waitEditor();
    fireEvent.click(mdBtn());
    const src = screen.getByRole('textbox', { name: /Описание.*markdown/i }) as HTMLTextAreaElement;
    expect(src.value).toBe('**жир**');
    expect(container.querySelector('.ProseMirror')).toBeNull();
    fireEvent.click(togetherBtn());
    const src2 = screen.getByRole('textbox', { name: /Описание.*markdown/i }) as HTMLTextAreaElement;
    fireEvent.change(src2, { target: { value: '## Новый' } });
    expect(container.querySelector('.sk-md__split .sk-prose h2')?.textContent).toBe('Новый');
  });

  it('переключение видов правки без набора не меняет текст (нет «дрейфа» от TipTap)', async () => {
    const onSave = vi.fn();
    const md = 'абзац\nс мягким переносом';
    render(<MdInlineEdit label="Описание" value={md} onSave={onSave} />);
    fireEvent.click(pen());
    await waitEditor();
    fireEvent.click(mdBtn()); // в исходник
    fireEvent.click(mdBtn()); // назад в набор
    fireEvent.click(mdBtn()); // снова в исходник
    expect((screen.getByRole('textbox', { name: /markdown/i }) as HTMLTextAreaElement).value).toBe(md);
  });

  it('«Сохранить» отдаёт markdown в onSave и возвращает в чтение с новым текстом', async () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(<MdInlineEdit label="Описание" value="старое" onSave={onSave} />);
    fireEvent.click(pen());
    await waitEditor();
    fireEvent.click(mdBtn());
    fireEvent.change(screen.getByRole('textbox', { name: /markdown/i }), { target: { value: '## новое' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith('## новое');
    await waitFor(() => expect(container.querySelector('.sk-prose h2')?.textContent).toBe('новое'));
    expect(editorBar()).toBeNull();
  });

  it('сбой сохранения — видимая ошибка, правка и черновик остаются (ничего не потеряно)', async () => {
    const onSave = vi.fn(async () => { throw new Error('409 конфликт'); });
    render(<MdInlineEdit label="Описание" value="старое" onSave={onSave} />);
    fireEvent.click(pen());
    await waitEditor();
    fireEvent.click(mdBtn());
    fireEvent.change(screen.getByRole('textbox', { name: /markdown/i }), { target: { value: 'черновик' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('409 конфликт');
    expect((screen.getByRole('textbox', { name: /markdown/i }) as HTMLTextAreaElement).value).toBe('черновик');
  });

  it('«Отмена» и Esc без правок возвращают в чтение, onSave не зовётся', async () => {
    const onSave = vi.fn();
    const { container } = render(<MdInlineEdit label="Описание" value="текст" onSave={onSave} />);
    fireEvent.click(pen());
    await waitEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(editorBar()).toBeNull();
    fireEvent.click(pen());
    await waitEditor();
    fireEvent.keyDown(container.querySelector('.sk-mdedit')!, { key: 'Escape' });
    expect(editorBar()).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Esc при несохранённой правке НЕ выбрасывает черновик (только явная «Отмена»)', async () => {
    render(<MdInlineEdit label="Описание" value="текст" onSave={() => {}} />);
    fireEvent.click(pen());
    await waitEditor();
    fireEvent.click(mdBtn());
    const src = screen.getByRole('textbox', { name: /markdown/i });
    fireEvent.change(src, { target: { value: 'новое' } });
    fireEvent.keyDown(src, { key: 'Escape' });
    expect((screen.getByRole('textbox', { name: /markdown/i }) as HTMLTextAreaElement).value).toBe('новое');
  });

  it('Ctrl+Enter сохраняет', async () => {
    const onSave = vi.fn(async () => {});
    render(<MdInlineEdit label="Описание" value="а" onSave={onSave} />);
    fireEvent.click(pen());
    await waitEditor();
    fireEvent.click(mdBtn());
    const src = screen.getByRole('textbox', { name: /markdown/i });
    fireEvent.change(src, { target: { value: 'б' } });
    await act(async () => { fireEvent.keyDown(src, { key: 'Enter', ctrlKey: true }); });
    expect(onSave).toHaveBeenCalledWith('б');
  });

  it('страховка S5-07: текст, который TipTap исказил бы, — визуальная правка закрыта, открыт исходник, причина видна', async () => {
    const { container } = render(<MdInlineEdit label="Описание" value={'до\n\n<details><summary>s</summary>t</details>'} onSave={() => {}} />);
    fireEvent.click(pen());
    await waitEditor();
    expect(mdBtn().getAttribute('aria-disabled')).toBe('true');
    expect(mdBtn().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/исказит/)).toBeTruthy();
    fireEvent.click(mdBtn());
    expect(container.querySelector('.ProseMirror')).toBeNull();
    expect(screen.getByRole('textbox', { name: /markdown/i })).toBeTruthy();
  });

  it('вид правки управляемый: mode/onMode — состояние может жить в URL у экрана', async () => {
    const onMode = vi.fn();
    const { container } = render(<MdInlineEdit label="Описание" value="а" onSave={() => {}} mode="split" onMode={onMode} />);
    fireEvent.click(pen());
    await waitEditor();
    expect(togetherBtn().getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.sk-md__split')).toBeTruthy();
    fireEvent.click(togetherBtn());
    expect(onMode).toHaveBeenCalledWith('code');
  });

  it('английская локаль', async () => {
    render(<KitLangProvider lang="en"><MdInlineEdit label="Body" value="x" onSave={() => {}} /></KitLangProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Edit “Body”/ }));
    await waitEditor();
    expect(screen.getByRole('button', { name: 'markdown source mode' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /show side by side/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});

// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-CONTENT-V4 (прототип v4): над текстом, который можно править,
// строка-подсказка «как править». Кнопки в ней больше нет — правку открывает
// одна ✎ (владелица 10.11.2026). Без onSave подсказки нет вовсе.
describe('S4-CONTENT-V4 · подсказка правки над текстом', () => {
  it('при onSave — подсказка словами, без второй кнопки правки; без onSave её нет', () => {
    const { container, unmount } = render(<KitLangProvider lang="ru"><MdInlineEdit value="Абзац" label="Описание" onSave={vi.fn()} /></KitLangProvider>);
    expect(screen.getByText(/правка на месте/)).toBeTruthy();
    expect(container.querySelectorAll('.sk-mdedit__hint button')).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    unmount();
    render(<KitLangProvider lang="ru"><MdInlineEdit value="Абзац" label="Описание" /></KitLangProvider>);
    expect(screen.queryByText(/правка на месте/)).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
