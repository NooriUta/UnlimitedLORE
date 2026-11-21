// @vitest-environment jsdom
// Владелица 21.11.2026 (канал, расшифровано из английской раскладки): «один момент графики встают над header а не
// отдельной вкладкой аналитика перенеси блок графиков в паспорте во вкладку аналитика».
// Слот `charts` паспорта: графики — вкладка «Графики» первой в режиме «Аналитика», а не блок над шапкой.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView, RECORD_TABS } from './RecordView';

beforeAll(() => { registerGameIcons(gameIcons); });

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринт', icon: 'scroll-quill', fields: [{ key: 'version', title: 'Версия', type: 'text' }] } },
  statuses: { items: [{ code: 'active', title: 'в работе', category: 'active', icon: 'calendar', color: 'var(--acc)' }] },
};
const rec: KitRecord = { id: 'SPR-1', kind: 'sprint', title: 'Спринт', status: 'active', fields: { version: '1' }, body_md: 'Текст спринта' };
const ctx: KitCtx = {
  config, data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-21T00:00:00Z' } },
  href: id => `#${id}`, esc: s => s, md: s => s,
};
const charts = <div data-testid="charts">ГРАФИКИ</div>;
const tabNames = () => screen.getAllByRole('tab').map(t => t.textContent?.replace(/\d+$/, ''));

describe('графики паспорта — вкладкой «Графики» в «Аналитике», не над шапкой', () => {
  it('на «Контенте» графиков нет', () => {
    render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="right" charts={charts} />);
    expect(screen.queryByTestId('charts')).toBeNull();
  });
  it('вкладка «Графики» — первая из вычисляемых и показывает графики', () => {
    render(<RecordView record={rec} ctx={ctx} tab={RECORD_TABS.charts} onTab={() => {}} placement="bottom" charts={charts} />);
    expect(tabNames()).toEqual(['Контент', 'Графики', 'Связи', 'Граф', 'Журнал']);
    expect(screen.getByTestId('charts')).toBeTruthy();
  });
  it('«Аналитика» открывает «Графики»', () => {
    const onTab = vi.fn();
    render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={onTab} placement="right" charts={charts} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Вид паспорта' })).getByRole('button', { name: 'Аналитика' }));
    expect(onTab).toHaveBeenLastCalledWith(RECORD_TABS.charts);
  });
  it('без графиков вкладки нет — «Аналитика» по-прежнему открывает «Связи»', () => {
    render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="bottom" />);
    expect(tabNames()).not.toContain('Графики');
  });
  it('колонкой слева (aroundAs=column) графики — первым блоком', () => {
    const { container } = render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="bottom" aroundAs="column" charts={charts} />);
    const around = container.querySelector('[data-zone="around"]') as HTMLElement;
    expect(within(around).getAllByRole('heading').map(h => h.textContent?.replace(/\d+$/, ''))[0]).toBe('Графики');
    expect(within(around).getByTestId('charts')).toBeTruthy();
  });
});
