// @vitest-environment jsdom
// Чип статуса на карточке — только при непустом статусе и непустой оси: пустой
// статус не рисует «вне словаря: ∅», а непустой код вне словаря чип сохраняет.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const rec = (id: string, status: string): KitRecord =>
  ({ id, kind: 'task', title: `Запись ${id}`, status, fields: {} });
const base: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'checkbox-tree', fields: [] } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list', 'cards'], columns: ['title+id', 'status'], groupings: ['status'], showClosed: 'all' },
};
const data: KitData = { records: [rec('a', 'todo'), rec('b', ''), rec('c', 'weird')], edges: [], journal: [], meta: { generated_at: '2026-11-08T12:00:00Z', total: 3 } };
const pick = (name: string) => fireEvent.click(within(screen.getByRole('radiogroup', { name: /Вид/ })).getByRole('radio', { name: name }));
const headChip = (container: HTMLElement, id: string): HTMLElement | null =>
  container.querySelector(`.sk-cards [data-record-id="${id}"] .sk-cards__head [data-status]`);

describe('карточки: чип статуса', () => {
  it('у записи без статуса чипа нет — ни словарного, ни «вне словаря: ∅»', () => {
    const { container } = render(<ListView config={base} data={data} urlState={false} />);
    pick('Карточки');
    expect(headChip(container, 'b')).toBeNull();
    const card = container.querySelector('.sk-cards [data-record-id="b"]') as HTMLElement;
    expect(card.textContent).not.toContain('∅');
    expect(card.textContent).not.toContain('вне словаря');
  });

  it('непустой код вне словаря чип сохраняет — честно помечен is-unknown', () => {
    const { container } = render(<ListView config={base} data={data} urlState={false} />);
    pick('Карточки');
    const chip = headChip(container, 'c');
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains('is-unknown')).toBe(true);
    expect(chip!.textContent).toContain('вне словаря: weird');
  });

  it('известный статус чип сохраняет', () => {
    const { container } = render(<ListView config={base} data={data} urlState={false} />);
    pick('Карточки');
    const chip = headChip(container, 'a');
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains('is-unknown')).toBe(false);
    expect(chip!.textContent).toContain('к работе');
  });

  it('оси статуса нет вовсе — чипов нет ни у кого', () => {
    const noAxis: KitConfig = { ...base, statuses: { items: [] } };
    const { container } = render(<ListView config={noAxis} data={data} urlState={false} />);
    pick('Карточки');
    expect(headChip(container, 'a')).toBeNull();
    expect(headChip(container, 'c')).toBeNull();
  });
});
