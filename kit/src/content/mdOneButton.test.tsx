// @vitest-environment jsdom
// Правка MD одной кнопкой (слова владелицы 10.11.2026): «не надо две кнопки
// редактирования — исходный текст есть по кнопке md в tiptap, и выбор
// „показывать вместе“ можно встроить туда же; плюс при просмотре рядом
// сжимается на половину ширина — так быть не должно, раздвигай, у нас есть
// большой запас».
//
// Что закрепляется и почему:
//   • в чтении РОВНО ОДНА кнопка правки. Их было две — ✎ и «Режим исходника»
//     в строке-подсказке, — и человек выбирал способ правки ещё до того, как
//     увидел редактор;
//   • исходник markdown и «показывать вместе» — кнопки в ряду самого
//     редактора; отдельного переключателя «код / превью / рядом» над полем
//     нет: выбор вида — внутри правки, а не до неё;
//   • «вместе» = исходник и живой просмотр рядом, и поле при этом
//     РАЗДВИГАЕТСЯ: на нём data-wide="side", а seidr.css снимает для него меру
//     чтения (--read-col) и у поля, и у колонки-предка. Иначе два поля делят
//     680 px пополам — по 340 px, ровно та «половина ширины», о которой речь;
//   • правка в исходнике доходит до onSave без переключения режима: источник
//     истины один, и «сохранить, не вернувшись в превью» не теряет текст;
//   • страховка S5-07 цела: где круг «MD → TipTap → MD» не сходится, визуальная
//     правка закрыта с причиной, а исходник и «вместе» работают.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import { MdInlineEdit } from './MdInlineEdit';

const pen = () => screen.getByRole('button', { name: /Править «Описание»/ });
const mdBtn = () => screen.getByRole('button', { name: 'режим markdown-источника' });
const together = () => screen.getByRole('button', { name: /показывать вместе/ });
const src = () => screen.getByRole('textbox', { name: /исходник markdown/ }) as HTMLTextAreaElement;
const toolbar = (c: HTMLElement) => c.querySelector('.sk-md__toolbar') as HTMLElement | null;
const openEdit = async (c: HTMLElement) => {
  fireEvent.click(pen());
  await waitFor(() => expect(toolbar(c)).toBeTruthy());
};

describe('правка MD — одна кнопка (владелица 10.11.2026)', () => {
  it('в чтении ровно одна кнопка правки — второй («Режим исходника») нет', () => {
    const { container } = render(<MdInlineEdit label="Описание" value="текст" onSave={() => {}} />);
    const btns = [...container.querySelectorAll('button')];
    expect(btns.map(b => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Править «Описание»']);
  });

  it('исходник и «показывать вместе» — кнопки в ряду редактора; переключателя режимов над полем нет', async () => {
    const { container } = render(<MdInlineEdit label="Описание" value="**жир**" onSave={() => {}} />);
    await openEdit(container);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(toolbar(container)!.contains(mdBtn())).toBe(true);
    expect(toolbar(container)!.contains(together())).toBe(true);
  });

  it('кнопка md открывает исходник, и правка в нём сохраняется без переключения режима', async () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(<MdInlineEdit label="Описание" value="**жир**" onSave={onSave} />);
    await openEdit(container);
    fireEvent.click(mdBtn());
    expect(src().value).toBe('**жир**');
    expect(container.querySelector('.ProseMirror')).toBeNull();
    fireEvent.change(src(), { target: { value: '## новое' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith('## новое');
  });

  it('«вместе» — исходник и живой просмотр рядом; поле раздвигается (data-wide="side")', async () => {
    const { container } = render(<MdInlineEdit label="Описание" value="**жир**" onSave={() => {}} />);
    await openEdit(container);
    fireEvent.click(together());
    const split = container.querySelector('.sk-md__split') as HTMLElement;
    expect(split).toBeTruthy();
    expect(split.querySelector('textarea')).toBeTruthy();
    fireEvent.change(src(), { target: { value: '## Новый' } });
    expect(split.querySelector('.sk-prose h2')?.textContent).toBe('Новый');
    expect(container.querySelector('.sk-mdedit')?.getAttribute('data-wide')).toBe('side');
    // Выключили «вместе» — поле снова обычной ширины, исходник остаётся.
    fireEvent.click(together());
    expect(container.querySelector('.sk-md__split')).toBeNull();
    expect(container.querySelector('.sk-mdedit')?.getAttribute('data-wide')).toBeNull();
    expect(src()).toBeTruthy();
  });

  it('страховка S5-07: TipTap исказил бы текст — визуальная правка закрыта с причиной, исходник и «вместе» работают', async () => {
    const { container } = render(
      <MdInlineEdit label="Описание" value={'до\n\n<details><summary>s</summary>t</details>'} onSave={() => {}} />,
    );
    await openEdit(container);
    expect(src()).toBeTruthy();
    expect(container.querySelector('.ProseMirror')).toBeNull();
    expect(screen.getByText(/исказит/)).toBeTruthy();
    expect(mdBtn().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(mdBtn());
    expect(container.querySelector('.ProseMirror')).toBeNull();
    fireEvent.click(together());
    expect(container.querySelector('.sk-md__split')).toBeTruthy();
  });
});

describe('seidr.css — «вместе» не делит ширину пополам', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/seidr.css'), 'utf8');

  it('положительный контроль: мера чтения у правки на месте в доке есть', () => {
    expect(css).toMatch(/\[data-placement='bottom'\][^{]*\.sk-mdedit[^{]*\{[^}]*max-width:\s*var\(--read-col\)/);
  });

  it('у поля в режиме «вместе» мера чтения снята — и у него, и у колонки-предка', () => {
    expect(css).toMatch(/\.sk-mdedit\[data-wide='side'\][^{]*\{[^}]*max-width:\s*none/);
    expect(css).toMatch(/:has\(\.sk-mdedit\[data-wide='side'\]\)[^{]*\{[^}]*max-width:\s*none/);
  });

  it('исходник и просмотр — равными долями, на телефоне одной колонкой', () => {
    expect(css).toMatch(/\.sk-md__split\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.sk-md__live\s*\{/);
  });
});
