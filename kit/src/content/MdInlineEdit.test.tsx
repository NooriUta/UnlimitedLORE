// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-06 — правка MD на месте, встроенная в режим
// чтения: текст читается MartProse, правка открывается ТОЛЬКО кнопкой ✎
// (касание по тексту на телефоне — прокрутка и выделение, а не случайный
// вход в правку), внутри — TipTap и переключатель «код / превью / рядом».
// Страховка — круг S5-07: где TipTap исказил бы текст, превью честно закрыто.
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
const modeBtn = (name: RegExp) => screen.getByRole('radio', { name });

describe('S5-06 · MdInlineEdit — чтение', () => {
  it('рисует markdown через MartProse и кнопку ✎; касание по тексту правку НЕ открывает', () => {
    const { container } = render(<MdInlineEdit label="Описание" value={'## Тело\n\n**жир**'} onSave={() => {}} />);
    expect(container.querySelector('.sk-prose h2')?.textContent).toBe('Тело');
    fireEvent.click(container.querySelector('.sk-prose')!);
    fireEvent.pointerUp(container.querySelector('.sk-prose')!);
    fireEvent.doubleClick(container.querySelector('.sk-prose')!);
    expect(screen.queryByRole('radiogroup')).toBeNull();
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
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeTruthy());
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('S5-06 · MdInlineEdit — правка', () => {
  it('✎ открывает правку: переключатель «код / превью / рядом», по умолчанию превью (TipTap)', async () => {
    const { container } = render(<MdInlineEdit label="Описание" value="**жир**" onSave={() => {}} />);
    fireEvent.click(pen());
    const group = screen.getByRole('radiogroup', { name: /Вид правки/ });
    expect(group).toBeTruthy();
    expect(modeBtn(/Код/).getAttribute('aria-checked')).toBe('false');
    expect(modeBtn(/Превью/).getAttribute('aria-checked')).toBe('true');
    expect(modeBtn(/Рядом/).getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(container.querySelector('.sk-md .ProseMirror strong')?.textContent).toBe('жир'));
  });

  it('«код» — исходник markdown в textarea; «рядом» — исходник и живой рендер одновременно', async () => {
    const { container } = render(<MdInlineEdit label="Описание" value="**жир**" onSave={() => {}} />);
    fireEvent.click(pen());
    fireEvent.click(modeBtn(/Код/));
    const src = screen.getByRole('textbox', { name: /Описание.*markdown/i }) as HTMLTextAreaElement;
    expect(src.value).toBe('**жир**');
    expect(container.querySelector('.ProseMirror')).toBeNull();
    fireEvent.click(modeBtn(/Рядом/));
    const src2 = screen.getByRole('textbox', { name: /Описание.*markdown/i }) as HTMLTextAreaElement;
    fireEvent.change(src2, { target: { value: '## Новый' } });
    expect(container.querySelector('.sk-mdedit__split .sk-prose h2')?.textContent).toBe('Новый');
  });

  it('переключение режимов без правки не меняет текст (нет «дрейфа» от TipTap)', async () => {
    const onSave = vi.fn();
    const md = 'абзац\nс мягким переносом';
    render(<MdInlineEdit label="Описание" value={md} onSave={onSave} />);
    fireEvent.click(pen());
    fireEvent.click(modeBtn(/Код/));
    fireEvent.click(modeBtn(/Превью/));
    fireEvent.click(modeBtn(/Код/));
    expect((screen.getByRole('textbox', { name: /markdown/i }) as HTMLTextAreaElement).value).toBe(md);
  });

  it('«Сохранить» отдаёт markdown в onSave и возвращает в чтение с новым текстом', async () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(<MdInlineEdit label="Описание" value="старое" onSave={onSave} />);
    fireEvent.click(pen());
    fireEvent.click(modeBtn(/Код/));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown/i }), { target: { value: '## новое' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith('## новое');
    await waitFor(() => expect(container.querySelector('.sk-prose h2')?.textContent).toBe('новое'));
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('сбой сохранения — видимая ошибка, правка и черновик остаются (ничего не потеряно)', async () => {
    const onSave = vi.fn(async () => { throw new Error('409 конфликт'); });
    render(<MdInlineEdit label="Описание" value="старое" onSave={onSave} />);
    fireEvent.click(pen());
    fireEvent.click(modeBtn(/Код/));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown/i }), { target: { value: 'черновик' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('409 конфликт');
    expect((screen.getByRole('textbox', { name: /markdown/i }) as HTMLTextAreaElement).value).toBe('черновик');
  });

  it('«Отмена» и Esc без правок возвращают в чтение, onSave не зовётся', () => {
    const onSave = vi.fn();
    render(<MdInlineEdit label="Описание" value="текст" onSave={onSave} />);
    fireEvent.click(pen());
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.click(pen());
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'Escape' });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Esc при несохранённой правке НЕ выбрасывает черновик (только явная «Отмена»)', () => {
    render(<MdInlineEdit label="Описание" value="текст" onSave={() => {}} />);
    fireEvent.click(pen());
    fireEvent.click(modeBtn(/Код/));
    const src = screen.getByRole('textbox', { name: /markdown/i });
    fireEvent.change(src, { target: { value: 'новое' } });
    fireEvent.keyDown(src, { key: 'Escape' });
    expect((screen.getByRole('textbox', { name: /markdown/i }) as HTMLTextAreaElement).value).toBe('новое');
  });

  it('Ctrl+Enter сохраняет', async () => {
    const onSave = vi.fn(async () => {});
    render(<MdInlineEdit label="Описание" value="а" onSave={onSave} />);
    fireEvent.click(pen());
    fireEvent.click(modeBtn(/Код/));
    const src = screen.getByRole('textbox', { name: /markdown/i });
    fireEvent.change(src, { target: { value: 'б' } });
    await act(async () => { fireEvent.keyDown(src, { key: 'Enter', ctrlKey: true }); });
    expect(onSave).toHaveBeenCalledWith('б');
  });

  it('страховка S5-07: текст, который TipTap исказил бы, — превью закрыто, открыт код, причина видна', () => {
    render(<MdInlineEdit label="Описание" value={'до\n\n<details><summary>s</summary>t</details>'} onSave={() => {}} />);
    fireEvent.click(pen());
    expect(modeBtn(/Превью/).getAttribute('aria-disabled')).toBe('true');
    expect(modeBtn(/Код/).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/исказит/)).toBeTruthy();
    fireEvent.click(modeBtn(/Превью/));
    expect(modeBtn(/Код/).getAttribute('aria-checked')).toBe('true');
  });

  it('режим управляемый: mode/onMode — состояние может жить в URL у экрана', () => {
    const onMode = vi.fn();
    render(<MdInlineEdit label="Описание" value="а" onSave={() => {}} mode="split" onMode={onMode} />);
    fireEvent.click(pen());
    expect(modeBtn(/Рядом/).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(modeBtn(/Код/));
    expect(onMode).toHaveBeenCalledWith('code');
  });

  it('английская локаль', () => {
    render(<KitLangProvider lang="en"><MdInlineEdit label="Body" value="x" onSave={() => {}} /></KitLangProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Edit “Body”/ }));
    expect(screen.getByRole('radio', { name: /Code/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Preview/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Side by side/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
