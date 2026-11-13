// @vitest-environment jsdom
// SPRINT_UXR_S12_KIT3_VOLVA_GRAPH/S6-04 — живые блоки (lore-query, lore-graph) в ПРАВИМОМ поле.
//
// До правки тело с правом записи читалось через MdInlineEdit, а тот рисовал MartProse без
// исполнителей: в паспорте, который можно править, блок оставался кодом. Ответ владелицы
// 11.11.2026 (вопрос 2): при открытии — превью, «рядом» включается само в режиме правки.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import { MdInlineEdit } from './MdInlineEdit';
import type { LiveBlockRun } from './LiveBlock';

const TEXT = 'Соседи спринта:\n\n```lore-graph\ndepth: 2\n```\n';
const pen = () => screen.getByRole('button', { name: /Править «Тело»/ });
const box = (c: HTMLElement) => c.querySelector('section.sk-mdedit') as HTMLElement;

function runner() {
  const calls: string[] = [];
  const run: LiveBlockRun = async source => { calls.push(source); return { kind: 'table', columns: [{ key: 'id', title: 'id' }], rows: [{ id: 'X' }] }; };
  return { run, calls };
}

describe('S6-04 · MdInlineEdit — живые блоки', () => {
  it('в чтении блок исполняется, а не остаётся кодом', async () => {
    const { run, calls } = runner();
    const { container } = render(<MdInlineEdit label="Тело" value={TEXT} onSave={() => {}} blocks={{ 'lore-graph': run }} />);
    await waitFor(() => expect(container.querySelector('.sk-live[data-lang="lore-graph"]')).toBeTruthy());
    expect(calls).toEqual(['depth: 2']);
  });

  it('без исполнителей — как раньше: блок остаётся кодом', () => {
    const { container } = render(<MdInlineEdit label="Тело" value={TEXT} onSave={() => {}} />);
    expect(container.querySelector('.sk-live')).toBeNull();
  });

  it('в правке текста с живым блоком сразу «рядом»: слева код, справа результат', async () => {
    const { run } = runner();
    const { container } = render(<MdInlineEdit label="Тело" value={TEXT} onSave={() => {}} blocks={{ 'lore-graph': run }} />);
    fireEvent.click(pen());
    await waitFor(() => expect(box(container).getAttribute('data-wide')).toBe('side'));
  });

  it('текст без живого блока открывается в превью, как раньше', async () => {
    const { run } = runner();
    const { container } = render(<MdInlineEdit label="Тело" value={'просто текст'} onSave={() => {}} blocks={{ 'lore-graph': run }} />);
    fireEvent.click(pen());
    await waitFor(() => expect(container.querySelector('.sk-md__toolbar')).toBeTruthy());
    expect(box(container).getAttribute('data-wide')).toBeNull();
  });

  it('управляемый режим вызывающего не перебивается', async () => {
    const { run } = runner();
    const { container } = render(<MdInlineEdit label="Тело" value={TEXT} onSave={() => {}} blocks={{ 'lore-graph': run }} mode="code" onMode={() => {}} />);
    fireEvent.click(pen());
    await waitFor(() => expect(container.querySelector('.sk-md__toolbar')).toBeTruthy());
    expect(box(container).getAttribute('data-wide')).toBeNull();
  });
});
