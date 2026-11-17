// @vitest-environment jsdom
// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-07: описание поля — подсказкой у подписи, «аналог peek» (владелица 16.11:
// «подсказки к полю да давай смотреть похоже на аналог peek»). Прототип — mdl07-field-hint.html.
// Подсказка: полное название, определение, описание. Нет ни определения, ни описания — подпись как раньше.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';
import { passportFromDoc, type KitRecordDoc } from './recordDoc';

const REC: KitRecord = { id: 'S-1', kind: 'Sprint', title: 'Спринт', status: 'active', fields: { start: '2026-11-10', code: 'KIT5' } };
const cfg = (fields: NonNullable<KitConfig['kinds'][string]['fields']>): KitCtx => ({
  data: { records: [REC], edges: [], journal: [], meta: { generated_at: '2026-11-16T12:00:00Z' } },
  config: { modules: [], menu: { groups: [] }, kinds: { Sprint: { title: 'Спринты', icon: 'scroll-quill', fields } }, statuses: { items: [] } },
  href: id => `#${id}`, esc: s => s, md: s => <div>{s}</div>,
});
const FIELDS = [
  { key: 'start', title: 'Плановое начало', type: 'date' as const, hint: { definition: 'Дата, с которой спринт должен начаться по плану.', description: 'Меняется только перепланированием.' } },
  { key: 'code', title: 'Код', type: 'text' as const },
];

describe('MDL-07 · подсказка у подписи поля', () => {
  it('поле с описанием: подпись помечена, по наведению — название, определение и описание', () => {
    render(<RecordView record={REC} ctx={cfg(FIELDS)} tab="overview" onTab={() => {}} />);
    const label = screen.getByTestId('kit-field-hint-start');
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(label);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Плановое начало');
    expect(tip.textContent).toContain('Дата, с которой спринт должен начаться по плану.');
    expect(tip.textContent).toContain('Меняется только перепланированием.');
    expect(label.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.mouseLeave(label);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('клавиатура и палец: фокус открывает, Esc закрывает, нажатие переключает', () => {
    render(<RecordView record={REC} ctx={cfg(FIELDS)} tab="overview" onTab={() => {}} />);
    const label = screen.getByTestId('kit-field-hint-start');
    expect(label.tabIndex).toBe(0);
    fireEvent.focus(label);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(label, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(label);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.click(label);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('поле без описания — обычная подпись, без пометки и подсказки', () => {
    render(<RecordView record={REC} ctx={cfg(FIELDS)} tab="overview" onTab={() => {}} />);
    expect(screen.queryByTestId('kit-field-hint-code')).toBeNull();
    expect(screen.getByText('Код').tagName).toBe('DT');
  });

  it('документ записи: definition и description поля доходят до подсказки', () => {
    const doc: KitRecordDoc = {
      contract: 'x/1',
      record: { type: 'sprint', id: 'S-1', title: 'Спринт', status: 'active', version: 'v1', updated_at: null, updated_by: null },
      schema: { type: 'sprint', label: 'Спринт', icon: 'scroll-quill', tabs: [], relations: [], fields: [
        { key: 'start', label: 'Плановое начало', kind: 'date', required: false, editable: false, group: 'props', definition: 'Дата начала по плану.', description: 'Ставится при планировании.' },
        { key: 'code', label: 'Код', kind: 'text', required: false, editable: false, group: 'props' },
      ] },
      values: { start: '2026-11-10', code: 'KIT5' }, links: [], parts: [],
      perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
      meta: { loaded_at: '2026-11-16T12:00:00Z', facade: 'server', sources: [] },
    };
    const f = passportFromDoc(doc, { lang: 'ru' }).kinds.sprint.fields ?? [];
    expect(f.find(x => x.key === 'start')?.hint).toEqual({ definition: 'Дата начала по плану.', description: 'Ставится при планировании.' });
    expect(f.find(x => x.key === 'code')?.hint).toBeUndefined();
  });
});
