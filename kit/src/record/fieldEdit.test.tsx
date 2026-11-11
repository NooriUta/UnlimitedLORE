// @vitest-environment jsdom
// Правка характеристик записи в «Свойствах» паспорта
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24, часть «правка характеристик»).
//
// Повод — слово владелицы 11.11.2026: «S4-FIELD-EDITORS нужны, а то как
// редактировать характеристики». Набор редакторов (FieldEditor) готов, но в
// паспорте характеристики только читались: поле видно, изменить нельзя.
//
// Правила:
//   • ✎ — только у поля, которое приложение назвало правимым (`editable`),
//     и только когда есть право и путь записи (hooks.onSave). Иначе ✎ обещал
//     бы сохранение, которого некуда отправить;
//   • редактор — тот же FieldEditor по виду поля, что везде (один код);
//   • «Сохранить» отправляет было/стало; «Отмена» ничего не пишет;
//   • сбой записи назван словами и правка не теряется — тихий откат выглядел
//     бы как успех.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { RecordView } from './RecordView';
import type { KitConfig, KitCtx, KitRecord, KindConfig } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

const record: KitRecord = {
  id: 'SP-1', kind: 'sprint', title: 'Спринт', status: 'active',
  fields: { priority: 'P1', planned_end_date: '2026-11-30', track: 'ui', created: '2026-11-01' },
};

const fields: NonNullable<KindConfig['fields']> = [
  { key: 'priority', title: 'Приоритет', type: 'enum', editable: true, options: ['P1', 'P2'] },
  { key: 'planned_end_date', title: 'Конец по плану', type: 'date', editable: true },
  { key: 'track', title: 'Трек', type: 'text', editable: true },
  { key: 'created', title: 'Создан', type: 'date' },
];

function ctxWith(hooks: KitConfig['hooks'], role = 'editor'): KitCtx {
  return {
    config: {
      modules: [], menu: { groups: [] }, statuses: { items: [] },
      kinds: { sprint: { title: 'Спринт', icon: 'scroll-unfurled', fields } },
      hooks,
    },
    data: { records: [record], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } },
    role, href: () => '#', esc: s => s, md: s => s,
  };
}

const show = (hooks: KitConfig['hooks'], role?: string) =>
  render(<RecordView record={record} ctx={ctxWith(hooks, role)} tab="overview" onTab={() => {}} propsOpen />);

describe('S4-24 · правка характеристик в «Свойствах»', () => {
  it('✎ есть только у правимых полей; у «Создан» (не правится) — нет', () => {
    show({ onSave: vi.fn(async () => {}) });
    expect(screen.getByRole('button', { name: 'Править «Приоритет»' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Править «Трек»' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Править «Создан»' })).toBeNull();
  });

  it('нет пути записи (hooks.onSave) — ✎ нет ни у одного поля', () => {
    show({});
    expect(screen.queryByRole('button', { name: /Править «Приоритет»/ })).toBeNull();
  });

  it('нет права правки (роль без canEdit) — ✎ нет', () => {
    const ctx = ctxWith({ onSave: vi.fn(async () => {}) }, 'viewer');
    ctx.config.roles = { viewer: { canEdit: false, canStatus: false } };
    render(<RecordView record={record} ctx={ctx} tab="overview" onTab={() => {}} propsOpen />);
    expect(screen.queryByRole('button', { name: /Править «Приоритет»/ })).toBeNull();
  });

  it('список: ✎ → FieldEditor → «Сохранить» отправляет было/стало', async () => {
    const onSave = vi.fn(async () => {});
    show({ onSave });
    fireEvent.click(screen.getByRole('button', { name: 'Править «Приоритет»' }));
    fireEvent.change(screen.getByLabelText('Приоритет'), { target: { value: 'P2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith({ type: 'sprint', id: 'SP-1', field: 'priority', from: 'P1', to: 'P2' });
    // После записи редактор закрыт — показано значение.
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
  });

  it('«Отмена» ничего не пишет и возвращает значение', () => {
    const onSave = vi.fn(async () => {});
    show({ onSave });
    fireEvent.click(screen.getByRole('button', { name: 'Править «Трек»' }));
    fireEvent.change(screen.getByLabelText('Трек'), { target: { value: 'новый' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('ui')).toBeTruthy();
  });

  it('сбой записи назван словами, редактор с набранным остаётся открытым', async () => {
    const onSave = vi.fn(async () => { throw new Error('409 запись изменена'); });
    show({ onSave });
    fireEvent.click(screen.getByRole('button', { name: 'Править «Конец по плану»' }));
    fireEvent.change(screen.getByLabelText('Конец по плану'), { target: { value: '2026-12-15' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/409 запись изменена/);
    expect((screen.getByLabelText('Конец по плану') as HTMLInputElement).value).toBe('2026-12-15');
  });

  it('ничего не изменили — «Сохранить» недоступна (пустая запись не уходит)', () => {
    show({ onSave: vi.fn(async () => {}) });
    fireEvent.click(screen.getByRole('button', { name: 'Править «Трек»' }));
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(document.body).getByLabelText('Трек')).toBeTruthy();
  });
});
