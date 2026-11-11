// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-08 — спор при сохранении: запись изменили,
// пока её правили, и сами слить не смогли. Поле правки показывает построчный
// дифф ТОЛЬКО спорных блоков, человек выбирает по каждому «моё» или «их»,
// собранный текст встаёт в черновик — и сохраняется обычной кнопкой.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axeViolations } from '../test/axe';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import { MdInlineEdit } from './MdInlineEdit';
import { MdMergeConflict, mergeBlocks } from './blockMerge';

const base = 'Первый.\n\nВторой\nобщая строка.\n\nТретий.';
const mine = 'Первый — моё.\n\nВторой\nмоя строка.\n\nТретий.';
const theirs = 'Первый.\n\nВторой\nих строка.\n\nТретий — их.';

async function openAndType(text: string) {
  fireEvent.click(screen.getByRole('button', { name: /Править «Описание»/ }));
  await waitFor(() => expect(document.querySelector('.sk-md__toolbar')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'режим markdown-источника' }));
  fireEvent.change(screen.getByRole('textbox', { name: /markdown/i }), { target: { value: text } });
}

describe('S5-08 · MdInlineEdit — спор при сохранении', () => {
  it('дифф только спорного блока; выбор → текст в черновике → сохранение', async () => {
    const merge = mergeBlocks(base, mine, theirs);
    expect(merge.conflicts).toBe(1);
    const onSave = vi.fn()
      .mockImplementationOnce(async () => { throw new MdMergeConflict(merge.chunks, 'agent-x'); })
      .mockImplementationOnce(async () => {});
    const { container } = render(<MdInlineEdit label="Описание" value={base} onSave={onSave} />);
    await openAndType(mine);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });

    const panel = await screen.findByRole('group', { name: /Спорные блоки/ });
    expect(panel.textContent).toContain('agent-x');
    // Дифф — только по спорному блоку: строки «их» и «моё» есть, неспорных блоков нет.
    expect(within(panel).getByText('их строка.')).toBeTruthy();
    expect(within(panel).getByText('моя строка.')).toBeTruthy();
    expect(panel.textContent).not.toContain('Первый — моё.');
    expect(panel.textContent).not.toContain('Третий — их.');
    expect(container.querySelectorAll('.sk-mdmerge__block')).toHaveLength(1);
    // Пока спор не решён — применять нечего.
    const apply = within(panel).getByRole('button', { name: /Применить/ });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(within(panel).getByRole('button', { name: /Оставить моё/ }));
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(apply);
    expect(screen.queryByRole('group', { name: /Спорные блоки/ })).toBeNull();
    // Неспорные правки обеих сторон слиты, спорный блок — мой.
    const want = 'Первый — моё.\n\nВторой\nмоя строка.\n\nТретий — их.';
    await waitFor(() => expect((screen.getByRole('textbox', { name: /markdown/i }) as HTMLTextAreaElement).value).toBe(want));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenLastCalledWith(want);
  });

  it('«Взять их» по спорному блоку', async () => {
    const merge = mergeBlocks(base, mine, theirs);
    const onSave = vi.fn(async () => { throw new MdMergeConflict(merge.chunks); });
    render(<MdInlineEdit label="Описание" value={base} onSave={onSave} />);
    await openAndType(mine);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    const panel = await screen.findByRole('group', { name: /Спорные блоки/ });
    fireEvent.click(within(panel).getByRole('button', { name: /Взять их/ }));
    fireEvent.click(within(panel).getByRole('button', { name: /Применить/ }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: /markdown/i }) as HTMLTextAreaElement).value)
      .toBe('Первый — моё.\n\nВторой\nих строка.\n\nТретий — их.'));
  });
});
