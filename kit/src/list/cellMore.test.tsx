// @vitest-environment jsdom
// Многозначная ячейка списка — в одну строку: первое значение и «+N» (SPRINT_UXR_POLISH_UAT_1113/PU-07).
// Приёмка 13.11: задача на 11 релизах — колонка «Релиз» рисовала каждый строкой, строка списка
// выросла в 5–8 обычных. Правило общее для любой многозначной колонки, не только релиза.
// Спрятанное не теряется: «+N» несёт полный список в подсказке и раскрывает его на месте.
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const config = {
  modules: [], menu: { groups: [] },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [{ key: 'release', title: 'Релиз', type: 'ref' }] } },
  list: { views: ['list'], columns: ['title+id', 'fields.release'], showClosed: 'all' },
} as unknown as KitConfig;
const REL = Array.from({ length: 11 }, (_, i) => `v1.17.${16 - i}`);
const rec = (id: string, release: unknown): KitRecord => ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields: { release } });
const draw = (records: KitRecord[]) => {
  const data: KitData = { records, edges: [], journal: [], meta: { generated_at: '2026-11-13T12:00:00Z', total: records.length } };
  return render(<ListView config={config} data={data} urlState={false} narrow={false} />);
};
const cellOf = (c: HTMLElement, id: string) => c.querySelector(`tr[data-id="${id}"] .sk-list__c-fields-release`) ?? [...c.querySelectorAll('tr')].find(tr => tr.textContent?.includes(id))!.querySelector('.sk-list__c-fields-release')!;

describe('PU-07 · многозначная ячейка — «v1.17.16 +10»', () => {
  it('11 релизов — видно одно значение и «+10», полный список в подсказке', () => {
    const { container } = draw([rec('a', REL)]);
    const cell = cellOf(container, 'a');
    expect(cell.querySelectorAll('.sk-list__val')).toHaveLength(1);
    const more = cell.querySelector('.sk-list__valmore') as HTMLButtonElement;
    expect(more.textContent).toBe('+10');
    expect(more.getAttribute('title')).toContain('v1.17.6');
  });
  it('«+N» раскрывает все значения на месте', () => {
    const { container } = draw([rec('a', REL)]);
    const cell = cellOf(container, 'a');
    fireEvent.click(cell.querySelector('.sk-list__valmore')!);
    expect(cell.querySelectorAll('.sk-list__val')).toHaveLength(11);
  });
  it('одно значение — как раньше, «+N» нет (положительный контроль)', () => {
    const { container } = draw([rec('a', ['v1.17.16'])]);
    const cell = cellOf(container, 'a');
    expect(cell.querySelectorAll('.sk-list__val')).toHaveLength(1);
    expect(cell.querySelector('.sk-list__valmore')).toBeNull();
  });
});
