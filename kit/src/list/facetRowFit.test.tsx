// @vitest-environment jsdom
// Ряд фасетов — в одну строку со свёрткой «+N» (SPRINT_UXR_POLISH_UAT_1113/PU-12).
//
// Повод — приёмка 13.11: список задач шириной ~800 px (меню рейкой), ряд
// «Фильтр / Поиск / Статус / Релиз / Спринт» переносился на вторую строку
// «Компоненты / Продукт / Изменены», «+N» не было. S9-12 свернул только строку
// АКТИВНЫХ условий (чипы); ряд кнопок фасетов на широком экране не сворачивался
// вовсе, а на телефоне он прячется под «Фильтры» и этим не страдает.
//
// Бюджет считается от КОНТЕЙНЕРА (переносится ли ряд), а не от ширины окна:
// с открытым справа паспортом окно то же, а места у списка вдвое меньше.
// jsdom раскладку не считает — перенос эмулируем через offsetTop: фасет,
// стоящий в ряду дальше FIT-го, «уезжает» на вторую строку.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { ListView } from './ListView';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import type { ListState } from './listModel';

beforeAll(() => { registerGameIcons(gameIcons); });

const KEYS = ['project', 'components', 'release', 'milestone', 'priority', 'owner'];
const records: KitRecord[] = Array.from({ length: 4 }, (_, i) => ({
  id: `S-${i}`, kind: 'sprint', title: `Спринт ${i}`, status: 'active',
  fields: Object.fromEntries(KEYS.map(k => [k, `${k}${i}`])),
}));
const data: KitData = { records, edges: [], journal: [], meta: { generated_at: 'x' } };
const config: KitConfig = {
  modules: [], menu: { groups: [] },
  statuses: { items: [{ code: 'active', title: 'В работе', category: 'active', icon: 'sprint', color: 'var(--acc)' }] },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint', fields: KEYS.map(k => ({ key: k, title: k.toUpperCase(), type: 'ref' as const })) } },
  list: { views: ['list'], filters: KEYS, columns: ['title'] },
};
const st = (filters: Record<string, string[]> = {}): ListState =>
  ({ view: 'list', quick: null, group: null, sort: null, filters, ops: {}, text: '' }) as ListState;

// Эмуляция переноса: в ряду влезает FIT фасетов, следующие и «+N» за ними — на второй строке.
let FIT = 3;
const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
beforeEach(() => {
  FIT = 3;
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const seg = this.closest('.sk-list__seg[data-seg="filter"]');
      if (!seg || this.parentElement !== seg) return 0;
      const facets = Array.from(seg.children).filter(c => c.classList.contains('sk-facet') || c.classList.contains('sk-list__facetmore'));
      const i = facets.indexOf(this);
      return i >= FIT ? 30 : 0;
    },
  });
});
afterEach(() => { if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetTop', desc); });

const facetTitles = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.sk-list__seg[data-seg="filter"] > .sk-facet')).map(f => f.textContent ?? '');
const more = (c: HTMLElement) => c.querySelector('.sk-list__facetmore') as HTMLButtonElement | null;

describe('ряд фасетов: не влезает — «+N», а не вторая строка (PU-12)', () => {
  it('влезает 3 из 6 → видны 2 фасета и «+4» (сама кнопка тоже занимает место)', () => {
    const { container } = render(<ListView config={config} data={data} state={st()} onStateChange={() => {}} narrow={false} />);
    // 3 места: 2 фасета + кнопка «+N»
    expect(facetTitles(container)).toHaveLength(2);
    expect(more(container)?.textContent).toContain('4');
  });
  it('всё влезает — «+N» нет', () => {
    FIT = 99;
    const { container } = render(<ListView config={config} data={data} state={st()} onStateChange={() => {}} narrow={false} />);
    expect(facetTitles(container)).toHaveLength(6);
    expect(more(container)).toBeNull();
  });
  it('«+N» раскрывает спрятанные на месте, «Свернуть» сворачивает', () => {
    const { container } = render(<ListView config={config} data={data} state={st()} onStateChange={() => {}} narrow={false} />);
    act(() => { fireEvent.click(more(container)!); });
    expect(facetTitles(container)).toHaveLength(6);
    expect(more(container)?.getAttribute('aria-expanded')).toBe('true');
    act(() => { fireEvent.click(more(container)!); });
    expect(facetTitles(container)).toHaveLength(2);
  });
  it('фасет с заданным условием не прячется в «+N»', () => {
    const { container } = render(<ListView config={config} data={data} state={st({ owner: ['owner1'] })} onStateChange={() => {}} narrow={false} />);
    expect(facetTitles(container).some(t => t.includes('OWNER'))).toBe(true);
  });
});
