// @vitest-environment jsdom
// SPRINT_UXR_S13_KIT4/K4-VERDICT-FILTER — условие по проверке вердикта в списке:
// ссылка «?lck=fail:quiz» открывает ровно записи с этим провалом, условие видно снимаемым
// чипом с текстом проверки, «Показано N» совпадает с числом из сводки.
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord, KitVerdict } from '../core/contract';
import { ListView } from './ListView';

const rec = (id: string): KitRecord => ({ id, kind: 'topic', title: `Тема ${id}`, status: '', fields: {} });
const V: Record<string, KitVerdict | undefined> = {
  t1: { score: 1, max: 2, failed: [{ code: 'quiz', message: 'нет квиза по руне темы' }], hints: [] },
  t2: { score: 1, max: 2, failed: [{ code: 'quiz', message: 'нет квиза по руне темы' }], hints: [] },
  t3: { score: 2, max: 2, failed: [], hints: [] },
};
const config = (withVerdict: boolean): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { topic: { title: 'Темы', icon: 'scroll-unfurled', fields: [] } },
  statuses: { items: [] },
  list: { views: ['list'], columns: ['title'] },
  ...(withVerdict ? { verdict: (r: KitRecord) => V[r.id] } : {}),
} as KitConfig);
const data: KitData = { records: ['t1', 't2', 't3'].map(rec), edges: [], journal: [], meta: { generated_at: '2026-11-15T12:00:00Z', total: 3 } };
const rows = (c: HTMLElement) => [...c.querySelectorAll('[data-record-id]')].map(e => e.getAttribute('data-record-id'));
const go = (search: string) => window.history.replaceState({}, '', search || window.location.pathname);

afterEach(() => go(''));

describe('K4-VERDICT-FILTER · список по ссылке', () => {
  it('положительный контроль: без условия в адресе — все три записи', () => {
    const { container } = render(<ListView config={config(true)} data={data} />);
    expect(new Set(rows(container))).toEqual(new Set(['t1', 't2', 't3']));
  });

  it('?lck=fail:quiz — ровно записи с этим провалом, и «Показано 2 из 3»', () => {
    go('?lck=fail:quiz');
    const { container } = render(<ListView config={config(true)} data={data} />);
    expect(new Set(rows(container))).toEqual(new Set(['t1', 't2']));
    expect(screen.getByTestId('kit-list-shown').textContent).toContain('2');
  });

  it('условие — снимаемым чипом с текстом проверки, а не кодом', () => {
    go('?lck=fail:quiz');
    render(<ListView config={config(true)} data={data} />);
    const desc = screen.getByTestId('kit-list-desc');
    expect(desc.textContent).toContain('нет квиза по руне темы');
    expect(desc.textContent).toContain('Не пройдено');
  });

  it('снятие чипа возвращает все записи и убирает условие из адреса', () => {
    go('?lck=fail:quiz');
    const { container } = render(<ListView config={config(true)} data={data} />);
    const chip = screen.getByTestId('kit-list-desc').querySelector('button');
    expect(chip, 'у чипа есть кнопка снять').toBeTruthy();
    fireEvent.click(chip!);
    expect(new Set(rows(container))).toEqual(new Set(['t1', 't2', 't3']));
    expect(new URLSearchParams(window.location.search).has('lck')).toBe(false);
  });

  it('вердикт на экране не считается — условие не действует, и это сказано словами', () => {
    go('?lck=fail:quiz');
    const { container } = render(<ListView config={config(false)} data={data} />);
    expect(new Set(rows(container))).toEqual(new Set(['t1', 't2', 't3']));
    expect(screen.getByTestId('kit-list-desc').textContent).toContain('условие не действует');
  });
});
