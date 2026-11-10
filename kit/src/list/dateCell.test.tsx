// @vitest-environment jsdom
// Поле-дата в списке печатается ДНЁМ, а не сырой отметкой (ревью владелицы
// 10.11.2026, UX-долг: «тип `date` в движке списка не обрабатывается — ISO с
// миллисекундами в «Технологиях»»).
//
// Корень: `valueCell` печатал значение поля как есть, не глядя на объявленный
// тип. Движок тип ЗНАЕТ (он приходит из модели, `KindConfig.fields[].type`), —
// значит и показывать день должен он, а не каждый экран своей обрезкой.
//
// Честность: отметку, которую не разобрали как дату, показываем КАК ПРИСЛАЛИ и
// помечаем подсказкой. «Не разобрали» ≠ «пусто»: по такому значению и находят
// кривые данные, а скрытое значение искать негде.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const rec = (id: string, start: unknown, updated_at?: string): KitRecord =>
  ({ id, kind: 'tech', title: `Запись ${id}`, status: 'todo', fields: { start }, ...(updated_at ? { updated_at } : {}) });

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { tech: { title: 'Технологии', icon: 'cog', fields: [{ key: 'start', title: 'С какого числа', type: 'date' }] } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list'], columns: ['title+id', 'fields.start', 'updated_at'], showClosed: 'all' },
};
const dataOf = (rs: KitRecord[]): KitData =>
  ({ records: rs, edges: [], journal: [], meta: { generated_at: '2026-11-10T12:00:00Z', total: rs.length } });

const cells = () => Array.from(document.querySelectorAll('tbody td')).map(td => td.textContent ?? '');

describe('движок списка: поле-дата', () => {
  it('положительный контроль: строка нарисована', () => {
    render(<ListView config={config} data={dataOf([rec('a', '2026-11-10T09:31:14.123Z')])} urlState={false} />);
    expect(screen.getByText('Запись a')).toBeTruthy();
  });

  it('отметка с миллисекундами показана днём, а не целиком', () => {
    render(<ListView config={config} data={dataOf([rec('a', '2026-11-10T09:31:14.123Z')])} urlState={false} />);
    const texts = cells();
    expect(texts.some(x => x.includes('2026-11-10')), `в клетках нет дня: ${texts.join(' | ')}`).toBe(true);
    expect(texts.some(x => x.includes('09:31:14.123')), 'сырая отметка всё ещё в клетке').toBe(false);
  });

  it('полная отметка остаётся в подсказке — по ней сверяются с ответом сервера', () => {
    render(<ListView config={config} data={dataOf([rec('a', '2026-11-10T09:31:14.123Z')])} urlState={false} />);
    const day = Array.from(document.querySelectorAll('time')).find(t => t.textContent === '2026-11-10');
    expect(day, 'день не нарисован элементом time').toBeTruthy();
    expect(day!.getAttribute('title')).toContain('09:31:14.123');
  });

  it('значение не разобрали как дату — показано как прислали, с пометкой', () => {
    render(<ListView config={config} data={dataOf([rec('a', 'через неделю')])} urlState={false} />);
    const raw = Array.from(document.querySelectorAll('time')).find(t => t.textContent === 'через неделю');
    expect(raw, 'непонятное значение пропало из клетки').toBeTruthy();
    expect(raw!.getAttribute('data-date')).toBe('raw');
    expect(raw!.getAttribute('title')).toMatch(/разобрал/i);
  });

  it('поля нет — прочерк, а не «1970»', () => {
    render(<ListView config={config} data={dataOf([rec('a', undefined)])} urlState={false} />);
    expect(cells().some(x => x.includes('1970'))).toBe(false);
    expect(cells().some(x => x.trim() === '—')).toBe(true);
  });
});
