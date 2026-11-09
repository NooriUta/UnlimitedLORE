// @vitest-environment jsdom
// Замечание владелицы по v1.17.4 (08.11.2026): «до сих пор левое меню не имеет
// свойства к сворачиванию».
//
// Разбор. Сворачивание есть с #924 и в релизе присутствует: кнопка стоит в
// шапке слева от названия приложения, иконкой, без видимой подписи. То есть
// работает, но не находится: безымянный «бургер» рядом с брендом читается как
// «меню» вообще, а не как «свернуть ЭТО меню», и стоит он далеко от того, чем
// управляет.
//
// Поэтому управление появилось там, где его ищут, — в самой колонке меню, с
// видимой подписью, которая говорит, ЧТО СЛУЧИТСЯ по нажатию. Кнопка в шапке
// остаётся: по ней уже выработана привычка, и с клавиатуры она ближе.
//
// В режиме рейки подпись скрывается тем же правилом, что прячет подписи
// пунктов, — остаётся иконка.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, createSafeStorage, registerGameIcons } from '../index';
import type { KitConfig } from '../index';
import type { UrlWindow } from '../resilience/urlState';

beforeAll(() => { registerGameIcons(gameIcons); });

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');

const CONFIG: KitConfig = {
  modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' }],
  menu: { groups: [{ id: 'work', title: 'Работа', items: [{ id: 'sprints', title: 'Спринты' }] }] },
  kinds: {}, statuses: { items: [] },
};

const win = (): UrlWindow => ({
  location: { pathname: '/', search: '', hash: '' },
  history: { pushState: () => {}, replaceState: () => {} },
});

const mem = () => {
  const m = new Map<string, string>();
  return createSafeStorage(() => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage));
};

const mount = () => render(<KitShell config={CONFIG} win={win()} storage={mem()} narrow={false}><p>экран</p></KitShell>);
const side = () => document.querySelector('.sk-shell__side') as HTMLElement;

describe('сворачивание меню видно в самом меню', () => {
  it('положительный контроль: колонка меню отрисована', () => {
    mount();
    expect(side()).toBeTruthy();
  });

  it('в колонке меню есть кнопка сворачивания с видимой подписью', () => {
    mount();
    const fold = within(side()).getByRole('button', { name: /Меню:/ });
    expect(fold.textContent).toMatch(/Меню:/);
  });

  it('подпись говорит, что случится: сначала рейка, потом ушко', () => {
    mount();
    const fold = () => within(side()).getByRole('button', { name: /Меню:/ });
    expect(fold().textContent).toMatch(/рейку/);
    fireEvent.click(fold());
    expect(within(side()).getByRole('button', { name: /Меню:/ }).textContent).toMatch(/скрыть/i);
  });

  it('кнопка в шапке остаётся — привычка и клавиатура', () => {
    mount();
    const header = document.querySelector('.sk-shell__top') as HTMLElement;
    expect(within(header).getByRole('button', { name: /Меню:/ })).toBeTruthy();
  });

  it('в рейке подпись скрыта тем же правилом, что у пунктов, — остаётся иконка', () => {
    expect(css).toMatch(/\.sk-shell--menu-rail \.sk-shell__label/);
    const fold = css.indexOf('.sk-shell__sidefold {');
    expect(fold, 'правило кнопки сворачивания в seidr.css').toBeGreaterThan(-1);
  });
});
