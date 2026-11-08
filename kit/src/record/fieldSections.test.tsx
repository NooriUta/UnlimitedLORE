// @vitest-environment jsdom
// Разделы в «Свойствах» (S4-36, паспорт спринта как в v1: блоки «Планирование» и «Модули»).
// Поле может нести section — подзаголовок раздела; поля без section идут первыми, как раньше.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint', fields: [
    { key: 'priority', title: 'Приоритет', type: 'enum' },
    { key: 'created', title: 'Создан', type: 'date', section: 'Планирование' },
    { key: 'planned_end_date', title: 'Конец по плану', type: 'date', section: 'Планирование' },
    { key: 'components', title: 'Компоненты', type: 'ref', section: 'Модули' },
  ] } },
  statuses: { items: [] },
};
const rec: KitRecord = { id: 'S', kind: 'sprint', title: 'S', status: '', fields: { priority: 'P1', created: '2026-11-07', planned_end_date: '2026-11-12', components: ['LORE'] } };
const ctx: KitCtx = { config, data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z' } }, href: id => `#${id}`, esc: s => s, md: s => s };

describe('разделы в «Свойствах»', () => {
  it('поля без раздела — первыми; затем подзаголовки разделов в порядке появления', () => {
    render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="bottom" />);
    const box = screen.getByTestId('kit-fields').closest('section') as HTMLElement;
    const heads = within(box).getAllByRole('heading').map(h => h.textContent);
    expect(heads).toEqual(['Планирование', 'Модули']);
    const plan = within(box).getByRole('group', { name: 'Планирование' });
    expect(within(plan).getByText('Создан')).toBeTruthy();
    expect(within(plan).getByText('2026-11-12')).toBeTruthy();
    expect(within(within(box).getByRole('group', { name: 'Модули' })).getByText('Компоненты')).toBeTruthy();
    expect(within(box).queryByRole('group', { name: 'Приоритет' })).toBeNull();
    expect(box.textContent?.indexOf('Приоритет')).toBeLessThan(box.textContent!.indexOf('Планирование'));
  });
});
