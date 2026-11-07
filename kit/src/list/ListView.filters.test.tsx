// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-05 — фильтры listView: условия «есть / нет /
// пусто / не пусто», поле «Релиз» (массив release_ids), поиск текста в ID и
// названии, иконки значений и счётчики. Всё — на клиенте по данным слайса.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

beforeAll(() => { registerGameIcons(gameIcons); });

const spr = (id: string, title: string, status: string, release_ids: unknown): KitRecord =>
  ({ id, kind: 'sprint', title, status, fields: { release_ids } });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринты', icon: 'sprint', fields: [{ key: 'release_ids', title: 'Релиз', type: 'ref' }] } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list'], filters: ['status', 'fields.release_ids'], columns: ['title+id', 'status', 'fields.release_ids'] },
};

const records = [
  spr('SPRINT_A', 'Оболочка v2', 'done', ['v1.2.0']),
  spr('SPRINT_B', 'Фильтры списка', 'todo', ['v1.2.0', 'v1.3.0']),
  spr('SPRINT_C', 'Völva запросы', 'todo', []),
  spr('SPRINT_D', 'Без релиза вовсе', 'todo', null),
];
const data: KitData = { records, edges: [], journal: [], meta: { generated_at: '2026-11-07T00:00:00Z', total: 4 } };
const shownIds = (c: HTMLElement) => [...c.querySelectorAll('[data-record-id]')].map(r => r.getAttribute('data-record-id'));
const relIcon = (_key: string, v: string) => (v ? { icon: 'open-book', color: 'var(--suc)' } : null);

function openFacet(name: RegExp) {
  const btn = screen.getByRole('button', { name });
  fireEvent.click(btn);
  expect(btn.getAttribute('aria-expanded')).toBe('true');
  const panel = document.getElementById(btn.getAttribute('aria-controls')!);
  expect(panel).toBeTruthy();
  return panel!;
}

describe('поиск текста в ID и названии', () => {
  it('сужает список по мере ввода и описывается в строке фильтра', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Текст в ID или названии' }), { target: { value: 'völva' } });
    expect(shownIds(container)).toEqual(['SPRINT_C']);
    expect(screen.getByTestId('kit-list-desc').textContent).toContain('Текст: «völva»');
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 1 из 4');
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтр' }));
    expect(shownIds(container)).toHaveLength(4);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });
});

describe('фасет «Релиз» — поле-массив, четыре условия, счётчики', () => {
  it('значения с иконкой и счётчиком; «есть» выбирает любое из отмеченных', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} valueIcon={relIcon} />);
    const panel = openFacet(/^Релиз/);
    const opt = within(panel).getByRole('checkbox', { name: /v1\.3\.0/ });
    expect(opt.closest('label')!.textContent).toContain('1');
    expect(opt.closest('label')!.querySelector('[data-icon="open-book"]')).toBeTruthy();
    fireEvent.click(opt);
    expect(shownIds(container)).toEqual(['SPRINT_B']);
    fireEvent.click(within(panel).getByRole('checkbox', { name: /v1\.2\.0/ }));
    expect(shownIds(container)).toEqual(['SPRINT_A', 'SPRINT_B']);
    expect(screen.getByTestId('kit-list-desc').textContent).toContain('Релиз: v1.3.0 | v1.2.0');
  });

  it('«нет» исключает отмеченные; «пусто» и «не пусто» — со счётчиками и без значений', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} />);
    const panel = openFacet(/^Релиз/);
    fireEvent.click(within(panel).getByRole('checkbox', { name: /v1\.3\.0/ }));
    fireEvent.click(within(panel).getByRole('radio', { name: /^нет/ }));
    expect(shownIds(container)).toEqual(['SPRINT_A', 'SPRINT_C', 'SPRINT_D']);
    expect(screen.getByTestId('kit-list-desc').textContent).toContain('Релиз: нет v1.3.0');

    const empty = within(panel).getByRole('radio', { name: /^пусто/ });
    expect(empty.textContent).toContain('2');
    fireEvent.click(empty);
    expect(empty.getAttribute('aria-checked')).toBe('true');
    expect(shownIds(container)).toEqual(['SPRINT_C', 'SPRINT_D']);
    expect(within(panel).queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByTestId('kit-list-desc').textContent).toContain('Релиз: пусто');

    fireEvent.click(within(panel).getByRole('radio', { name: /^не пусто/ }));
    expect(shownIds(container)).toEqual(['SPRINT_A', 'SPRINT_B']);
  });

  it('счётчики значений считают с прочими фильтрами (статус «готово» → у v1.3.0 ноль строк)', () => {
    render(<ListView config={cfg} data={data} urlState={false} initial={{ filters: { status: ['done'] } }} />);
    const panel = openFacet(/^Релиз/);
    expect(within(panel).queryByRole('checkbox', { name: /v1\.3\.0/ })).toBeNull();
    expect(within(panel).getByRole('checkbox', { name: /v1\.2\.0/ }).closest('label')!.textContent).toContain('1');
  });

  it('Escape закрывает панель и возвращает фокус на кнопку фасета', () => {
    render(<ListView config={cfg} data={data} urlState={false} />);
    const btn = screen.getByRole('button', { name: /^Релиз/ });
    const panel = openFacet(/^Релиз/);
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
  });

  it('ячейка поля-массива — значения с иконкой, а не JSON; пусто — прочерк', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} valueIcon={relIcon} />);
    const cell = container.querySelector('[data-record-id="SPRINT_B"] .sk-list__c-fields-release-ids')!;
    expect(cell.textContent).toBe('v1.2.0v1.3.0');
    expect(cell.querySelectorAll('[data-icon="open-book"]')).toHaveLength(2);
    expect(container.querySelector('[data-record-id="SPRINT_D"] .sk-list__c-fields-release-ids')!.textContent).toBe('—');
  });

  it('фасет статуса — иконки статусов из словаря по умолчанию; axe без нарушений', async () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} />);
    const panel = openFacet(/^Статус/);
    expect(within(panel).getByRole('checkbox', { name: /готово/ }).closest('label')!.querySelector('[data-icon="divided-spiral"]')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
