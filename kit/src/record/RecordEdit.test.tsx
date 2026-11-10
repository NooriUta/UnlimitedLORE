// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-06 · правка на месте встроена в режим чтения
// записи: тело и md-поля читаются как раньше, а при праве на правку
// (config.hooks.onSave + roles[role].canEdit) рядом с ними — кнопка ✎.
// Редактор приходит пропом mdEditor (MdInlineEdit из `@seidr/kit/content`):
// главная точка входа kit не тянет TipTap экранам без правки.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import { MartProse, MdInlineEdit } from '../content';
import { RecordView } from './RecordView';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';

const record: KitRecord = {
  id: 'S5-06', kind: 'Task', title: 'Правка на месте', status: 'todo',
  fields: { note_md: '**заметка**' }, body_md: '## Тело',
};

function ctxWith(config: Partial<KitConfig>, role?: string): KitCtx {
  return {
    data: { records: [record], edges: [], journal: [], meta: { generated_at: 'x' } },
    config: {
      modules: [], menu: { groups: [] }, statuses: { items: [] },
      kinds: { Task: { title: 'Задача', icon: 'scroll-unfurled', fields: [{ key: 'note_md', title: 'Заметка', type: 'md' }] } },
      ...config,
    },
    role,
    href: id => `#${id}`,
    esc: s => s,
    md: s => <MartProse text={s} />,
  };
}

describe('S5-06 · RecordView — правка на месте в режиме чтения', () => {
  it('без mdEditor — чтение как прежде, кнопок ✎ нет', () => {
    const onSave = vi.fn(async () => {});
    render(<RecordView record={record} ctx={ctxWith({ hooks: { onSave } })} tab="overview" onTab={() => {}} />);
    expect(screen.queryByRole('button', { name: /Править/ })).toBeNull();
  });

  it('без hooks.onSave — ✎ нет даже с mdEditor (сохранять некуда)', () => {
    render(<RecordView record={record} ctx={ctxWith({})} tab="overview" onTab={() => {}} mdEditor={MdInlineEdit} />);
    expect(screen.queryByRole('button', { name: /Править/ })).toBeNull();
  });

  it('роль без canEdit — только чтение', () => {
    const onSave = vi.fn(async () => {});
    const ctx = ctxWith({ hooks: { onSave }, roles: { viewer: { canEdit: false, canStatus: false } } }, 'viewer');
    render(<RecordView record={record} ctx={ctx} tab="overview" onTab={() => {}} mdEditor={MdInlineEdit} />);
    expect(screen.queryByRole('button', { name: /Править/ })).toBeNull();
  });

  it('с правом: ✎ у тела и у md-поля; сохранение тела идёт в hooks.onSave с from/to', async () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(
      <RecordView record={record} ctx={ctxWith({ hooks: { onSave } })} tab="overview" onTab={() => {}} mdEditor={MdInlineEdit} />,
    );
    expect(container.querySelector('.sk-prose h2')?.textContent).toBe('Тело');
    expect(screen.getByRole('button', { name: /Править «Заметка»/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Править «Текст»/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'режим markdown-источника' }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown/i }), { target: { value: '## Новое тело' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith({ type: 'Task', id: 'S5-06', field: 'body_md', from: '## Тело', to: '## Новое тело' });
  });

  it('сохранение md-поля — field = ключ поля', async () => {
    const onSave = vi.fn(async () => {});
    render(<RecordView record={record} ctx={ctxWith({ hooks: { onSave } })} tab="overview" onTab={() => {}} mdEditor={MdInlineEdit} />);
    fireEvent.click(screen.getByRole('button', { name: /Править «Заметка»/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'режим markdown-источника' }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown/i }), { target: { value: 'иначе' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith({ type: 'Task', id: 'S5-06', field: 'note_md', from: '**заметка**', to: 'иначе' });
  });

  it('пустое тело с правом — «Текста нет» и ✎ (а не тупик без способа написать)', () => {
    const onSave = vi.fn(async () => {});
    render(<RecordView record={{ ...record, body_md: '' }} ctx={ctxWith({ hooks: { onSave } })} tab="overview" onTab={() => {}} mdEditor={MdInlineEdit} />);
    expect(screen.getByRole('button', { name: /Править «Текст»/ })).toBeTruthy();
  });
});
