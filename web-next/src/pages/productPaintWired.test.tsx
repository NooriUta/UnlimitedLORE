// @vitest-environment jsdom
// S4-PRODUCT-HILITE — цвет продукта доходит до живого списка (не «написано и не
// вызывается»): экран грузит срез products, красит записи по своим компонентам
// и рисует колонку «Продукт»; не загрузился срез — список жив, а причина сказана
// словами (честное состояние, а не тихая пропажа цвета).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { ListScreen } from './ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SPRINTS = {
  rows: [{ sprint_id: 'SPRINT_A', name: 'Спринт А', status_raw: '🔄 IN PROGRESS', components: ['HND'], git_projects: [], release_ids: [] }],
  truncated: false,
};
const PRODUCTS = { rows: [{ code: 'LORE', label_ru: 'Лор-продукт', color: '#E0A13D', components: ['HND'] }], truncated: false };

function fakeWin(): UrlWindow {
  const w = {
    location: { pathname: '/', search: '', hash: '' },
    history: { pushState: () => {}, replaceState: () => {} },
  };
  return w as unknown as UrlWindow;
}

function net(products: () => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/lore/slice/products')) return products();
    if (u.includes('/lore/slice/sprints')) return json(SPRINTS);
    if (u.includes('/lore/slice/sprint_totals')) return json({ rows: [], truncated: false });
    return json({ rows: [], truncated: false });
  }) as unknown as typeof fetch;
}

describe('цвет продукта в живом списке', () => {
  it('у спринта с компонентом продукта — чип продукта с его цветом', async () => {
    const fetchImpl = net(() => json(PRODUCTS));
    render(<ListScreen screen="sprints" fetchImpl={fetchImpl} urlState={fakeWin()} />);
    expect(await screen.findByText('Спринт А', {}, { timeout: 8000 })).toBeTruthy();
    const chip = await screen.findByText('Лор-продукт', {}, { timeout: 8000 });
    const mark = chip.closest('.sk-list__val')?.querySelector('.sk-list__vicon');
    expect(mark, 'иконка значения с цветом продукта').toBeTruthy();
    // Цвет — стилем иконки; jsdom приводит его к своей записи, сравниваем так же.
    const probe = document.createElement('i');
    probe.style.color = '#E0A13D';
    expect((mark!.querySelector('svg') as SVGElement | null)?.style.color).toBe(probe.style.color);
  });

  it('срез продуктов не загрузился — список на месте, причина словами', async () => {
    const fetchImpl = net(() => json({ error: 'BOOM', detail: 'нет связи' }, 502));
    render(<ListScreen screen="sprints" fetchImpl={fetchImpl} urlState={fakeWin()} />);
    expect(await screen.findByText('Спринт А', {}, { timeout: 8000 })).toBeTruthy();
    await waitFor(() => {
      const warn = document.querySelector('.list-screen__warn')?.textContent ?? '';
      expect(warn).toMatch(/цвет продукта/i);
    }, { timeout: 8000 });
  });
});
