// @vitest-environment jsdom
// S4-24 «Редактировать всё» (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24). Владелица 11.11: «полноэкранный
// контент можно редактировать только частями, нет общей кнопки редактировать». Выбор 13.11 —
// «кнопка наверху сохранить», прототип docs/prototypes/s4-24-edit-all.html одобрен («да норм
// прототип берем»).
//  · во весь экран под заголовком — «✎ Редактировать» (при праве и пути записи);
//  · режим правки: полоса «изменено N — какие · Отмена · Сохранить» наверху; тексты — исходник,
//    простые поля — ввод, связи — чипы с × / ↺ и «+ добавить»; изменения копятся;
//  · «Сохранить» неактивна с причиной, пока изменений нет; сохраняет одним действием —
//    onSave на каждое изменённое поле, onRelation на каждую привязку/отвязку;
//  · не сохранилось — правка не закрывается, неудачное названо;
//  · «Отмена» с изменениями — подтверждение со списком потерь.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

const rec: KitRecord = {
  id: 'ADR-1', kind: 'adr', title: 'Решение', status: 'ok',
  fields: { context_md: 'Контекст', effort: 3, components: ['FORSETI', 'OMILORE'] },
};
function setup(over: { onSave?: KitConfig['hooks'] extends infer H ? H extends { onSave?: infer S } ? S : never : never } = {}) {
  const onSave = over.onSave ?? vi.fn(async () => {});
  const onRelation = vi.fn(async () => {});
  const config = {
    modules: [], menu: { groups: [] },
    kinds: { adr: { title: 'ADR', icon: 'scroll-quill', fields: [
      { key: 'context_md', title: 'Контекст', type: 'md' },
      { key: 'effort', title: 'Оценка', type: 'number', editable: true },
      { key: 'components', title: 'Компоненты', type: 'ref', relation: { rel: 'BELONGS_TO', dir: 'out' } },
    ] } },
    statuses: { items: [{ code: 'ok', title: 'Принято', category: 'done', icon: 'check-mark', color: 'var(--suc)' }] },
    roles: { reader: { canEdit: true, canStatus: false } },
    hooks: { onSave, onRelation, relationOptions: async () => [{ id: 'SEIDRKIT', title: 'SEIDRKIT' }] },
  } as unknown as KitConfig;
  const ctx = { config, data: { records: [rec], edges: [], journal: [], meta: { generated_at: 'x' } }, role: 'reader', href: (id: string) => `#${id}`, esc: (s: string) => s, md: (s: string) => s } as unknown as KitCtx;
  const Editor = ({ value }: { value: string }) => <div>{value}</div>;
  const utils = render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="full" mdEditor={Editor} />);
  return { ...utils, onSave, onRelation };
}
const editBtn = () => screen.getByRole('button', { name: /Редактировать/ });
const saveBtn = () => screen.getByRole('button', { name: 'Сохранить' });

describe('S4-24 · «Редактировать всё» во весь экран', () => {
  it('кнопка под заголовком; в правке «Сохранить» неактивна с причиной, пока изменений нет', () => {
    setup();
    fireEvent.click(editBtn());
    expect((saveBtn() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('kit-editall-why').textContent).toMatch(/нет изменений/);
  });

  it('правка текста, поля и отвязка связи — «изменено 3», сохранение одним действием', async () => {
    const { onSave, onRelation } = setup();
    fireEvent.click(editBtn());
    fireEvent.change(screen.getByLabelText('Контекст'), { target: { value: 'Новый контекст' } });
    fireEvent.change(screen.getByLabelText('Оценка'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Отвязать: OMILORE/ }));
    expect(screen.getByTestId('kit-editall-state').textContent).toMatch(/3/);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ field: 'context_md', from: 'Контекст', to: 'Новый контекст' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ field: 'effort', from: 3, to: 5 }));
    expect(onRelation).toHaveBeenCalledWith(expect.objectContaining({ rel: 'BELONGS_TO', target: 'OMILORE', action: 'remove' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull());
  });

  it('не сохранилось — правка не закрывается, поле названо', async () => {
    setup({ onSave: vi.fn(async () => { throw new Error('409 перечитайте'); }) });
    fireEvent.click(editBtn());
    fireEvent.change(screen.getByLabelText('Контекст'), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(saveBtn()).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Контекст.*409/);
  });

  it('«Отмена» с изменениями — подтверждение со списком потерь', () => {
    setup();
    fireEvent.click(editBtn());
    fireEvent.change(screen.getByLabelText('Контекст'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    const dlg = screen.getByRole('alertdialog');
    expect(dlg.textContent).toMatch(/Контекст/);
    fireEvent.click(screen.getByRole('button', { name: 'Выйти без сохранения' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(editBtn()).toBeTruthy();
  });
});

describe('S4-24 · тексты записи — разделы тела (bodySections), как у ADR', () => {
  it('раздел тела правится исходником и сохраняется своим ключом', async () => {
    const onSave = vi.fn(async () => {});
    const r2: KitRecord = { id: 'ADR-2', kind: 'adr', title: 'Т', status: 'ok', fields: { decision_md: 'Было' } };
    const config = {
      modules: [], menu: { groups: [] },
      kinds: { adr: { title: 'ADR', icon: 'scroll-quill', bodySections: [{ key: 'decision_md', title: 'Решение' }, { key: 'ro_md', title: 'Только чтение', editable: false }], fields: [] } },
      statuses: { items: [{ code: 'ok', title: 'Принято', category: 'done', icon: 'check-mark', color: 'var(--suc)' }] },
      roles: { reader: { canEdit: true, canStatus: false } }, hooks: { onSave },
    } as unknown as KitConfig;
    const ctx = { config, data: { records: [r2], edges: [], journal: [], meta: { generated_at: 'x' } }, role: 'reader', href: (id: string) => `#${id}`, esc: (s: string) => s, md: (s: string) => s } as unknown as KitCtx;
    const Editor = ({ value }: { value: string }) => <div>{value}</div>;
    render(<RecordView record={r2} ctx={ctx} tab="overview" onTab={() => {}} placement="full" mdEditor={Editor} />);
    fireEvent.click(editBtn());
    expect(screen.queryByLabelText('Только чтение')).toBeNull();
    fireEvent.change(screen.getByLabelText('Решение'), { target: { value: 'Стало' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ field: 'decision_md', from: 'Было', to: 'Стало' }));
  });
});
