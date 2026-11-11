// @vitest-environment jsdom
// Всплывающие окна списка на телефоне — нижним листом
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-EDGE, ADR-LORE-049 п.1,
// D-2026-UXR-MOBILE-FOLLOWS-V1).
//
// Замер на живом v2 (360×800, pointer: coarse, «Спринты»): панель «Вид ▾»
// вставала с l=280 шириной 324 — 244 px за правым краем и выше экрана; панель
// фасета t=697 высотой 480 — 377 px под нижним краем. «Группировка» и
// «Порядок» — такие же поповеры у кнопки. Причина одна: правило «на ≤720
// поповеры становятся нижними листами» в kit не было реализовано, а эталон
// уже есть — лист «Проекты» (ScopePicker → Sheet side="bottom").
//
// Правило, которое закрепляется: на узком экране ВСЕ четыре окна строки
// управления открываются тем же Sheet снизу (во всю ширину, прокрутка внутри,
// затемнение, Esc/касание мимо закрывают); на широком — прежний поповер.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { ListView } from './ListView';
import type { KitConfig, KitData, KitRecord } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });
afterEach(cleanup);

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ruleOf = (sel: string) => {
  const re = new RegExp(`(?:^|[,}])\\s*${sel.replace(/[.[\]*+?^${}()|\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`, 'm');
  return re.exec(css)?.[1] ?? '';
};

const records: KitRecord[] = Array.from({ length: 6 }, (_, i) => ({
  id: `S-${i}`, kind: 'sprint', title: `Спринт ${i}`, status: i % 2 ? 'active' : 'done',
  fields: { project: `P${i % 3}` },
}));
const data: KitData = { records, edges: [], journal: [], meta: { generated_at: 'x' } };
const config: KitConfig = {
  modules: [], menu: { groups: [] },
  statuses: {
    items: [
      { code: 'active', title: 'В работе', category: 'active', icon: 'sprint', color: 'var(--acc)' },
      { code: 'done', title: 'Готово', category: 'done', icon: 'sprint', color: 'var(--suc)' },
    ],
  },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint', fields: [{ key: 'project', title: 'Проект', type: 'enum' }] } },
  list: { views: ['list'], columns: ['title+id', 'status'], filters: ['project'], groupings: ['status', 'project'] },
};

const show = (narrow: boolean) => render(
  <ListView config={config} data={data} urlState={false} narrow={narrow} href={id => `#${id}`} />,
);

type Opener = { name: string; btn: (root: HTMLElement) => HTMLElement | null };
const OPENERS: Opener[] = [
  { name: '«Вид ▾»', btn: r => r.querySelector('.sk-vmenu__btn') },
  { name: 'фасет фильтра', btn: r => r.querySelector('.sk-facet__btn') },
  { name: '«Группировка»', btn: r => r.querySelector('[data-seg="group"] .sk-gmenu__btn') },
  { name: '«Порядок»', btn: r => r.querySelector('[data-seg="sort"] .sk-gmenu__btn') },
];

const sheets = () => [...document.body.querySelectorAll<HTMLElement>('.sk-sheet.sk-sheet--bottom')];

describe('S4-MOBILE-EDGE · окна строки управления на телефоне — нижним листом', () => {
  for (const o of OPENERS) {
    it(`${o.name}: на телефоне — модальный лист снизу с затемнением`, () => {
      const { container } = show(true);
      const btn = o.btn(container);
      expect(btn, 'кнопка-открыватель').toBeTruthy();
      fireEvent.click(btn!);
      const s = sheets();
      expect(s).toHaveLength(1);
      expect(s[0].getAttribute('role')).toBe('dialog');
      expect(s[0].getAttribute('aria-modal')).toBe('true');
      expect(s[0].classList.contains('sk-lsheet')).toBe(true);
      expect(document.body.querySelector('.sk-sheet-backdrop')).toBeTruthy();
      // прежнего поповера у кнопки при этом нет
      expect(container.querySelector('.sk-vmenu__panel, .sk-facet__panel:not([hidden])')).toBeNull();
    });

    it(`${o.name}: касание внутри листа его НЕ закрывает, Esc и подложка — закрывают`, () => {
      const { container } = show(true);
      fireEvent.click(o.btn(container)!);
      const sheet = sheets()[0];
      const inside = within(sheet).queryAllByRole('radio')[0] ?? sheet.querySelector('.sk-sheet__body')!;
      fireEvent.mouseDown(inside);
      expect(sheets()).toHaveLength(1);
      fireEvent.keyDown(sheets()[0], { key: 'Escape' });
      expect(sheets()).toHaveLength(0);
      fireEvent.click(o.btn(container)!);
      fireEvent.click(document.body.querySelector('.sk-sheet-backdrop')!);
      expect(sheets()).toHaveLength(0);
    });

    it(`${o.name}: положительный контроль — на широком экране прежний поповер, не лист`, () => {
      const { container } = show(false);
      fireEvent.click(o.btn(container)!);
      expect(sheets()).toHaveLength(0);
      expect(container.querySelector('.sk-vmenu__panel, .sk-facet__panel:not([hidden])')).toBeTruthy();
    });
  }

  it('лист: тело — колонкой, без горизонтальной прокрутки', () => {
    expect(ruleOf('.sk-lsheet .sk-sheet__body')).toMatch(/flex-direction:\s*column/);
    expect(ruleOf('.sk-lsheet .sk-sheet__body')).toMatch(/overflow-x:\s*hidden/);
    // эталонный лист: во всю ширину и не выше экрана
    expect(ruleOf('.sk-sheet--bottom')).toMatch(/left:\s*0/);
    expect(ruleOf('.sk-sheet--bottom')).toMatch(/right:\s*0/);
    expect(ruleOf('.sk-sheet--bottom')).toMatch(/max-height:/);
  });
});
