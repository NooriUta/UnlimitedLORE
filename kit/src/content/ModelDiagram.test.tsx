// @vitest-environment jsdom
// Кубик «Схема модели»: честное «пусто», разрезы, статусы с переходами.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelDiagram } from './ModelDiagram';

afterEach(cleanup);

const DOC = {
  format: 'model/0', version: 't', partial: false, missing: [], statuses_known: ['a'],
  statuses: { a: { entries: [{ code: 'x', title: 'Икс', category: 'not_started', allow: ['y'] }, { code: 'y', title: 'Игрек', category: 'in_force', allow: [] }] } },
  types: { a: { type: 'a', label: 'Альфа', fields: [{ key: 'name', label: 'Имя', kind: 'text', group: 'head' }], relations: [] },
    b: { type: 'b', label: 'Бета', fields: [], relations: [] } },
  surfaces: { nav: [{ id: 'g', label: 'Группа', items: [{ section: 'a' }, { section: 'b' }] }] },
};

describe('ModelDiagram', () => {
  it('модель не пришла / не разобралась — словами, а не пустой рамкой', () => {
    render(<ModelDiagram model={null} />);
    expect(screen.getByRole('status').textContent).toMatch(/Модель не пришла|did not arrive/);
    cleanup();
    render(<ModelDiagram model={new Error('нет format')} />);
    expect(screen.getByRole('status').textContent).toContain('нет format');
  });
  it('статусы выбранного вида и куда из них можно; конечный — «никуда»', () => {
    render(<ModelDiagram model={DOC} />);
    expect(screen.getByText(/Статусы вида «Альфа»|Statuses of «Альфа»/)).toBeTruthy();
    const rows = screen.getAllByRole('row').map((r) => r.textContent);
    expect(rows.some((t) => t?.includes('Икс') && t.includes('Игрек'))).toBe(true);
    expect(rows.some((t) => /никуда|nowhere/.test(t ?? ''))).toBe(true);
  });
  it('разрезы: группы меню из документа и «вся модель» с числом видов', () => {
    render(<ModelDiagram model={DOC} />);
    expect(screen.getByRole('button', { name: 'Группа' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Вся модель · 2|Whole model · 2/ }));
    expect(screen.getByRole('button', { name: /Вся модель · 2|Whole model · 2/ }).getAttribute('aria-pressed')).toBe('true');
  });
  it('связи без известного конца — строкой под схемой; «большая» — строкой, а не окном, и только для всей модели', () => {
    const doc = { ...DOC, types: { ...DOC.types, b: { type: 'b', label: 'Бета', fields: [], relations: [{ key: 'z', label: 'Зет', rel: 'OLD', dir: 'out', relation: 'association' }] } } };
    render(<ModelDiagram model={doc} />);
    expect(screen.getByText(/Бета.*OLD|OLD.*Бета/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
