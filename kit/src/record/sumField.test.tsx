// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09 — итоги спринта в ПАСПОРТЕ.
//
// В списке спринтов сумма с охватом рисуется ячейкой `sum:` (SumCell): число,
// «у 9 из 14», «не заполнено» вместо нуля. В паспорте того же итога не было —
// поле с суммой печаталось как объект. Поле типа `sum` рисуется ТОЙ ЖЕ
// SumCell: одно число — один вид в обоих местах.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint', fields: [
    { key: 'effort_total', title: 'Оценка, дн', type: 'sum' },
    { key: 'actual_total', title: 'Факт, дн', type: 'sum' },
  ] } },
  statuses: { items: [] },
};
const view = (fields: Record<string, unknown>) => {
  const rec: KitRecord = { id: 'S', kind: 'sprint', title: 'S', status: '', fields };
  const ctx: KitCtx = { config, data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } }, href: id => `#${id}`, esc: s => s, md: s => s };
  render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="bottom" />);
  const row = (title: string) => screen.getByText(title).closest('.sk-rec-fields__row') as HTMLElement;
  return row;
};

describe('S4-09 · поле-сумма в паспорте', () => {
  it('заполнено у части — число и охват, как в списке', () => {
    const row = view({ effort_total: { value: 12.5, known: 9, of: 14 }, actual_total: { value: null, known: 0, of: 14 } });
    const cell = row('Оценка, дн').querySelector('.sk-sum') as HTMLElement;
    expect(cell).toBeTruthy();
    expect(cell.getAttribute('data-sum')).toBe('partial');
    expect(row('Оценка, дн').textContent).toMatch(/12,5/);
    expect(row('Оценка, дн').textContent).toMatch(/9 из 14/);
  });

  it('не заполнено ни у кого — «не заполнено», а не ноль и не «[object Object]»', () => {
    const row = view({ effort_total: { value: 3, known: 3, of: 3 }, actual_total: { value: null, known: 0, of: 14 } });
    const dd = row('Факт, дн');
    expect(dd.querySelector('.sk-sum')?.getAttribute('data-sum')).toBe('empty');
    expect(dd.textContent).not.toMatch(/object|^0$/);
  });

  it('не посчитали — «?» с причиной, а не прочерк', () => {
    const row = view({ effort_total: { error: 'сервер не прислал числа итогов' } });
    const cell = row('Оценка, дн').querySelector('.sk-sum') as HTMLElement;
    expect(cell.getAttribute('data-sum')).toBe('error');
    expect(cell.getAttribute('title')).toMatch(/сервер не прислал/);
  });
});
