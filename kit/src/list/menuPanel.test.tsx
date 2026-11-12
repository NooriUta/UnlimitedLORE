// @vitest-environment jsdom
// Поповеры строки управления — поверх клиппера дока (SPRINT_UXR_POLISH_V11717/P-06).
//
// Симптом: при открытом паспорте список сжат в .sk-dock__backdrop { overflow: auto },
// и абсолютные панели «Вид», «Группировка» и «Порядок» срезались границей дока.
// Закрепляем фикс: панель рендерится порталом в body (вне клиппера) и позиционируется
// fixed — правило в seidr.css, top/left по кнопке-якорю держит list/MenuPanel.tsx.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
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

const OPENERS = [
  { name: '«Вид ▾»', btn: (root: HTMLElement) => root.querySelector('.sk-vmenu__btn') },
  { name: '«Группировка»', btn: (root: HTMLElement) => root.querySelector('[data-seg="group"] .sk-gmenu__btn') },
  { name: '«Порядок»', btn: (root: HTMLElement) => root.querySelector('[data-seg="sort"] .sk-gmenu__btn') },
];

describe('поповеры строки управления — поверх клиппера дока', () => {
  for (const o of OPENERS) {
    it(`${o.name}: панель — порталом в body, вне контейнера с прокруткой`, () => {
      // обёртка имитирует .sk-dock__backdrop: клиппер, обрезающий абсолютный поповер
      const { container } = render(
        <div className="sk-dock__backdrop" data-clip>
          <ListView config={config} data={data} urlState={false} narrow={false} href={id => `#${id}`} />
        </div>,
      );
      const clipper = container.querySelector('[data-clip]')!;
      fireEvent.click(o.btn(container)!);
      const panel = document.body.querySelector('.sk-vmenu__panel');
      expect(panel, 'панель открылась').toBeTruthy();
      expect(clipper.contains(panel!), 'панель вне клиппера').toBe(false);
      expect(panel!.parentElement, 'панель — прямой ребёнок body').toBe(document.body);
    });
  }

  it('щелчок внутри панели её не закрывает, мимо — закрывает', () => {
    const { container } = render(
      <div className="sk-dock__backdrop" data-clip>
        <ListView config={config} data={data} urlState={false} narrow={false} href={id => `#${id}`} />
      </div>,
    );
    fireEvent.click(container.querySelector('.sk-vmenu__btn')!);
    const panel = document.body.querySelector('.sk-vmenu__panel')!;
    fireEvent.mouseDown(panel);
    expect(document.body.querySelector('.sk-vmenu__panel'), 'клик внутри — панель на месте').toBeTruthy();
    fireEvent.mouseDown(container.querySelector('[data-clip]')!);
    expect(document.body.querySelector('.sk-vmenu__panel'), 'клик мимо — панель закрылась').toBeNull();
  });

  it('панель позиционируется fixed (правило seidr.css)', () => {
    expect(ruleOf('.sk-vmenu__panel')).toMatch(/position:\s*fixed/);
  });
});
