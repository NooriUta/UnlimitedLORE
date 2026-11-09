// @vitest-environment jsdom
// Строка условий на телефоне: «+N» ВИДЕН, строка не раздвигает страницу
// (SPRINT_UXR_S9_SCALE_OPT/S9-12, находка CJM на проде 09.11.2026).
//
// Что намерили на проде (серверная сессия, прод v1.17.7): при ширине экрана
// 393 px строка условий вышла шириной 688 px, «+1 условий» встал на x=528 —
// ЗА КРАЕМ. Вся страница получила scrollWidth 728 и поехала вбок, вместе с
// верхней панелью, «Группировкой» и «Порядком».
//
// ДВЕ ПРИЧИНЫ, и обе здесь закрываются.
//   1. Порог «сколько условий в строке» был ОДИН на все экраны — три. Три
//      условия вида «Поле: значение» на 393 px не влезают ни при каком
//      шрифте, и свёртка «+N» оказывалась за краем.
//   2. Сама строка не могла стать уже своего содержимого: у flex-элемента без
//      `min-width: 0` минимальная ширина равна содержимому, поэтому
//      `overflow-x: auto` не спасал — вместо прокрутки внутри строки ехала
//      ВСЯ СТРАНИЦА. И «+N» с «Сбросить» лежали ВНУТРИ прокручиваемой части,
//      то есть уезжали вместе с чипами.
//
// Правило, которое закрепляется: что бы ни было в условиях, кнопка «+N» и
// «Сбросить» остаются на виду, а листать можно сами чипы.
import { beforeAll, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { ListView } from './ListView';
import { CHIPS_INLINE, CHIPS_INLINE_NARROW } from './listModel';
import type { KitConfig, KitData, KitRecord } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ruleOf = (sel: string) => {
  const re = new RegExp(`(?:^|[,}])\\s*${sel.replace(/[.[\]*+?^${}()|\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`, 'm');
  return re.exec(css)?.[1] ?? '';
};

const records: KitRecord[] = Array.from({ length: 6 }, (_, i) => ({
  id: `S-${i}`, kind: 'sprint', title: `Спринт ${i}`, status: 'active',
  fields: { project: `P${i}`, components: `C${i}`, release: `v${i}`, milestone: `M${i}`, priority: `P${i % 3}` },
}));
const data: KitData = { records, edges: [], journal: [], meta: { generated_at: 'x' } };
const config: KitConfig = {
  modules: [], menu: { groups: [] },
  statuses: { items: [{ code: 'active', title: 'В работе', category: 'active', icon: 'sprint', color: 'var(--acc)' }] },
  kinds: {
    sprint: {
      title: 'Спринт', icon: 'sprint',
      fields: [
        { key: 'project', title: 'Проект', type: 'enum' },
        { key: 'components', title: 'Компоненты', type: 'enum' },
        { key: 'release', title: 'Релиз', type: 'enum' },
        { key: 'milestone', title: 'Веха', type: 'enum' },
        { key: 'priority', title: 'Приоритет', type: 'enum' },
      ],
    },
  },
  list: { views: ['list'], filters: ['project', 'components', 'release', 'milestone', 'priority'] },
};

/** Четыре активных условия в адресе — больше любого порога. */
const FILTERED = {
  filters: { project: ['P1'], components: ['C1'], release: ['v1'], milestone: ['M1'] },
};

const show = (narrow: boolean) => render(
  <ListView config={config} data={data} urlState={false} initial={FILTERED} narrow={narrow} href={id => `#${id}`} />,
);

const chips = (root: ParentNode) => [...root.querySelectorAll('[data-testid="kit-list-desc"] .sk-pill--filter')];
const more = (root: ParentNode) => root.querySelector('.sk-list__chipmore') as HTMLElement | null;
const scroller = (root: ParentNode) => root.querySelector('.sk-list__chipscroll') as HTMLElement | null;

describe('S9-12 · условия на телефоне: порог по ширине экрана', () => {
  it('положительный контроль: на широком экране порог прежний', () => {
    const { container } = show(false);
    expect(chips(container).length).toBe(CHIPS_INLINE);
    expect(more(container)).toBeTruthy();
  });

  it('на телефоне условий в строке МЕНЬШЕ — три на 393 px не влезают ни при каком шрифте', () => {
    const { container } = show(true);
    expect(CHIPS_INLINE_NARROW).toBeLessThan(CHIPS_INLINE);
    expect(chips(container).length).toBe(CHIPS_INLINE_NARROW);
  });

  it('«+N» считает ВСЁ спрятанное, а не разницу с чужим порогом', () => {
    const { container } = show(true);
    // Четыре условия, показано CHIPS_INLINE_NARROW — в свёртке остальные.
    expect(more(container)?.textContent).toContain(String(4 - CHIPS_INLINE_NARROW));
  });
});

describe('S9-12 · «+N» и «Сбросить» не уезжают за край', () => {
  it('чипы лежат в своей прокручиваемой полосе', () => {
    const { container } = show(true);
    const box = scroller(container);
    expect(box, 'полоса прокрутки чипов').toBeTruthy();
    expect(chips(container).every(c => box!.contains(c))).toBe(true);
  });

  it('«+N» и «Сбросить» — ВНЕ полосы: иначе уезжают вместе с чипами', () => {
    const { container } = show(true);
    const box = scroller(container);
    expect(box!.contains(more(container)!)).toBe(false);
    const reset = [...container.querySelectorAll('[data-testid="kit-list-desc"] .sk-btn')].pop() as HTMLElement;
    expect(box!.contains(reset)).toBe(false);
  });

  it('строка умеет становиться уже содержимого — иначе едет вся страница', () => {
    // Главная причина «scrollWidth 728 при экране 393»: у flex-элемента без
    // min-width: 0 минимальная ширина равна содержимому.
    expect(ruleOf('.sk-list__desc')).toMatch(/min-width:\s*0/);
    expect(ruleOf('.sk-list__chipscroll')).toMatch(/min-width:\s*0/);
    expect(ruleOf('.sk-list__chipscroll')).toMatch(/overflow-x:\s*auto/);
  });
});

describe('S9-12 · склонение «+N условий»', () => {
  it('одно условие — «условие», а не «условий»', () => {
    const one = { filters: { project: ['P1'], components: ['C1'] } };
    const { container } = render(
      <ListView config={config} data={data} urlState={false} initial={one} narrow href={id => `#${id}`} />,
    );
    // Показано CHIPS_INLINE_NARROW = 1, спрятано одно.
    expect(more(container)?.textContent).toMatch(/\+1 условие/);
  });

  it('два — «условия», пять — «условий»: три формы русского, а не одна', () => {
    const { container } = show(true);
    expect(more(container)?.textContent).toMatch(/\+3 условия/);
  });
});
