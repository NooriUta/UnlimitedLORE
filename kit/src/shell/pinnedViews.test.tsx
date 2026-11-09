// @vitest-environment jsdom
// «Мои виды»: до пяти закреплённых плюс «Все виды»
// (SPRINT_UXR_S9_SCALE_OPT/S9-12).
//
// Повод: при росте числа видов левое меню перестаёт влезать — все виды
// рисовались списком без ограничения, и разделы уезжали вниз, под виды.
//
// Пять — число владелицы из задачи, не моё. Остальные не исчезают: пункт «Все
// виды (N)» раскрывает их НА МЕСТЕ. Отдельного окна со списком видов не
// делаю — это была бы новая поверхность, а значит решение о виде, которого
// задача не требует.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, PINNED_VIEWS, createSafeStorage, registerGameIcons, type KitConfig, type UrlWindow } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

const config: KitConfig = {
  modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-quill' }],
  menu: {
    myViews: true,
    groups: [{ id: 'work', title: 'Работа', items: [{ id: 'sprint', title: 'Спринты' }] }],
  },
  kinds: {}, statuses: { items: [] },
};

const win = (): UrlWindow => {
  const w: UrlWindow = {
    location: { pathname: '/', search: '', hash: '' },
    history: { pushState: () => {}, replaceState: () => {} },
  };
  return w;
};

/** Хранилище с n сохранёнными видами. */
function storageWith(n: number) {
  const views = Array.from({ length: n }, (_, i) => ({
    id: `v${i}`, title: `Вид ${i}`, module: 'lore', item: 'sprint', view: null,
  }));
  const m = new Map<string, string>([['seidr-kit.views', JSON.stringify(views)]]);
  return createSafeStorage(() => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage));
}

const show = (n: number) => render(
  <KitShell config={config} win={win()} storage={storageWith(n)} narrow={false}>
    <p>экран</p>
  </KitShell>,
);

const viewLinks = () => [...document.querySelectorAll('.sk-shell__side-nav .sk-shell__row')];
const allBtn = () => document.querySelector('.sk-shell__viewsmore') as HTMLButtonElement | null;

describe('S9-12 · до пяти закреплённых видов', () => {
  it('положительный контроль: три вида — все три на месте, кнопки «Все виды» нет', () => {
    show(3);
    expect(viewLinks().length).toBe(3);
    expect(allBtn()).toBeNull();
  });

  it('ровно пять — тоже все, порог не перейдён', () => {
    show(5);
    expect(viewLinks().length).toBe(PINNED_VIEWS);
    expect(allBtn()).toBeNull();
  });

  it('восемь видов — закреплённых пять и пункт «Все виды», а не стена из восьми', () => {
    show(8);
    expect(viewLinks().length).toBe(PINNED_VIEWS);
    expect(allBtn()).toBeTruthy();
  });

  it('«Все виды» называет число спрятанных — иначе непонятно, сколько скрыто', () => {
    show(8);
    expect(allBtn()?.textContent).toContain('3');
  });

  it('«Все виды» раскрывает остальные на месте', () => {
    show(8);
    fireEvent.click(allBtn()!);
    expect(viewLinks().length).toBe(8);
  });

  it('раскрыли и свернули — снова пять', () => {
    show(8);
    fireEvent.click(allBtn()!);
    fireEvent.click(allBtn()!);
    expect(viewLinks().length).toBe(PINNED_VIEWS);
  });

  it('кнопка «Сохранить вид» остаётся на месте при любом числе видов', () => {
    show(8);
    expect(screen.getByRole('button', { name: /Сохранить вид/ })).toBeTruthy();
  });
});
