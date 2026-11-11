// @vitest-environment jsdom
// Телефон: список по умолчанию — карточками (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-COMPARE).
//
// Замер 11.11.2026 (v2, 360×800, пальцевый ввод): во всех десяти разделах
// таблица в 6–11 колонок шире экрана (прокрутка 310 → 1195 px), колонка
// «Запись» сжата до 69 px. У «Задач» и «Вопросов» первая строка вообще ниже
// экрана — 832 px при высоте 800. На том же экране карточек помещается 9, а
// строк таблицы 2. В v1 список на телефоне — карточками.
// Решение владелицы D-2026-UXR-MOBILE-FOLLOWS-V1: образец мобильного вида — v1.
//
// Закрепляемое правило: на узком экране вид ПО УМОЛЧАНИЮ — «Карточки», если
// раздел их предлагает. Явный выбор человека (кнопка, адрес lv=, сохранённый
// вид через initial) — закон: kit его не переспоривает.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { ListView } from './ListView';
import type { KitConfig, KitData, KitRecord } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

const records: KitRecord[] = Array.from({ length: 4 }, (_, i) => ({
  id: `S-${i}`, kind: 'sprint', title: `Спринт ${i}`, status: 'active', fields: { project: `P${i}` },
}));
const data: KitData = { records, edges: [], journal: [], meta: { generated_at: 'x' } };
const config = (views: string[]): KitConfig => ({
  modules: [], menu: { groups: [] },
  statuses: { items: [{ code: 'active', title: 'В работе', category: 'active', icon: 'sprint', color: 'var(--acc)' }] },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint', fields: [{ key: 'project', title: 'Проект', type: 'enum' }] } },
  list: { views: views as never, filters: ['project'] },
});

const isCards = (root: ParentNode) => !!root.querySelector('.sk-cards');
const isTable = (root: ParentNode) => !!root.querySelector('.sk-list__table');

describe('S4-MOBILE-COMPARE · на телефоне список по умолчанию — карточками', () => {
  it('положительный контроль: на широком экране по умолчанию таблица', () => {
    const { container } = render(<ListView config={config(['list', 'cards'])} data={data} urlState={false} narrow={false} href={id => `#${id}`} />);
    expect(isTable(container)).toBe(true);
    expect(isCards(container)).toBe(false);
  });

  it('на узком экране по умолчанию — карточки, и переключатель показывает именно их', () => {
    const { container } = render(<ListView config={config(['list', 'cards'])} data={data} urlState={false} narrow href={id => `#${id}`} />);
    expect(isCards(container)).toBe(true);
    expect(isTable(container)).toBe(false);
    expect(container.querySelector('.sk-vmenu__btn')?.textContent).toMatch(/Карточки|Cards/);
  });

  it('карточка на телефоне открывает запись — заголовок ссылкой, а не немой текст', () => {
    const { container } = render(<ListView config={config(['list', 'cards'])} data={data} urlState={false} narrow href={id => `#${id}`} />);
    const card = container.querySelector('.sk-cards__card');
    expect(card).toBeTruthy();
    expect(card!.querySelector('a, button')).toBeTruthy();
  });

  it('явный выбор «Список» на телефоне — закон: таблица остаётся', () => {
    const { container } = render(<ListView config={config(['list', 'cards'])} data={data} urlState={false} narrow href={id => `#${id}`} />);
    fireEvent.click(container.querySelector('.sk-vmenu__btn')!);
    const list = [...container.querySelectorAll('.sk-vmenu__kinds [role="radio"]')].find(b => /Список|List/.test(b.textContent ?? ''))!;
    fireEvent.click(list);
    expect(isTable(container)).toBe(true);
    expect(isCards(container)).toBe(false);
  });

  it('вид, заданный приложением (initial / сохранённый вид), на телефоне не переспоривается', () => {
    const { container } = render(<ListView config={config(['list', 'cards'])} data={data} urlState={false} initial={{ view: 'list' }} narrow href={id => `#${id}`} />);
    expect(isTable(container)).toBe(true);
  });

  it('вид из адреса (lv=) на телефоне не переспоривается', () => {
    const win = { location: { pathname: '/', search: '?lv=list', hash: '' }, history: { pushState: () => {}, replaceState: () => {} } };
    const { container } = render(<ListView config={config(['list', 'cards'])} data={data} urlState={win as never} narrow href={id => `#${id}`} />);
    expect(isTable(container)).toBe(true);
  });

  // Владелица 11.11: «список карточка список доска — в мобильном состоянии
  // наверное должен быть в составе дропдаун меню вместе с его кнопкой вид».
  // Строка из пяти видов на 360 px переносилась в блок на две строки над
  // списком; в меню «Вид ▾» она не занимает места, а кнопка говорит, какой вид сейчас.
  describe('виды на телефоне — внутри меню «Вид ▾», а не строкой над списком', () => {
    const phone = () => render(<ListView config={config(['list', 'cards', 'board'])} data={data} urlState={false} narrow href={id => `#${id}`} />);

    it('положительный контроль: на десктопе строка видов на месте', () => {
      const { container } = render(<ListView config={config(['list', 'cards', 'board'])} data={data} urlState={false} narrow={false} href={id => `#${id}`} />);
      expect(container.querySelector('.sk-list__views')).toBeTruthy();
    });

    it('на телефоне строки видов над списком нет', () => {
      const { container } = phone();
      expect(container.querySelector('.sk-list__views')).toBeNull();
    });

    it('кнопка «Вид» называет текущий вид', () => {
      const { container } = phone();
      expect(container.querySelector('.sk-vmenu__btn')?.textContent).toMatch(/Карточки|Cards/);
    });

    it('в открытом меню виды первым разделом, выбор применяется сразу', () => {
      const { container } = phone();
      fireEvent.click(container.querySelector('.sk-vmenu__btn')!);
      const panel = container.querySelector('.sk-vmenu__panel')!;
      const group = panel.querySelector('[role="radiogroup"]')!;
      expect(group.getAttribute('aria-label')).toMatch(/Вид|View/);
      const radios = [...group.querySelectorAll('[role="radio"]')].map(b => b.textContent?.trim());
      expect(radios.length).toBe(3);
      fireEvent.click([...group.querySelectorAll('[role="radio"]')].find(b => /Список|List/.test(b.textContent ?? ''))!);
      expect(isTable(container)).toBe(true);
    });
  });

  it('раздел без карточек на телефоне остаётся при своём первом виде', () => {
    const { container } = render(<ListView config={config(['list'])} data={data} urlState={false} narrow href={id => `#${id}`} />);
    expect(isTable(container)).toBe(true);
  });
});

// Владелица 11.11: «фильтры и порядок прятаться под more». В v1 на телефоне
// полоса свёрнута в одну строку «фильтры 0 · не заданы ▸ развернуть»; в v2
// фильтр, группировка и порядок занимали ~400 px над первой записью.
describe('фильтр, группировка и порядок на телефоне — свёрнуты под одной кнопкой', () => {
  const segs = (root: ParentNode) => [...root.querySelectorAll('.sk-list__controls .sk-list__seg')]
    .filter(s => !(s as HTMLElement).closest('.is-folded'));
  const toggle = (root: ParentNode) => root.querySelector('.sk-list__fold') as HTMLButtonElement | null;

  it('положительный контроль: на десктопе полоса раскрыта и кнопки свёртки нет', () => {
    const { container } = render(<ListView config={config(['list', 'cards'])} data={data} urlState={false} narrow={false} href={id => `#${id}`} />);
    expect(segs(container).length).toBeGreaterThan(0);
    expect(toggle(container)).toBeNull();
  });

  it('на телефоне сегменты свёрнуты, кнопка говорит, что внутри, и aria-expanded=false', () => {
    const { container } = render(<ListView config={config(['list', 'cards'])} data={data} urlState={false} narrow href={id => `#${id}`} />);
    expect(container.querySelector('.sk-list__controls.is-folded')).toBeTruthy();
    const b = toggle(container)!;
    expect(b).toBeTruthy();
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(b.textContent).toMatch(/Фильтр|Filter/);
  });

  it('кнопка раскрывает и сворачивает полосу', () => {
    const { container } = render(<ListView config={config(['list', 'cards'])} data={data} urlState={false} narrow href={id => `#${id}`} />);
    fireEvent.click(toggle(container)!);
    expect(container.querySelector('.sk-list__controls.is-folded')).toBeNull();
    expect(toggle(container)!.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle(container)!);
    expect(container.querySelector('.sk-list__controls.is-folded')).toBeTruthy();
  });

  it('в свёрнутом виде видно, что фильтр задан: число условий на кнопке', () => {
    const { container } = render(<ListView config={config(['list', 'cards'])} data={data} urlState={false} initial={{ filters: { project: ['P1'] } }} narrow href={id => `#${id}`} />);
    expect(toggle(container)!.textContent).toMatch(/1/);
  });
});

it('свёрнутая полоса действительно прячет сегменты (правило в seidr.css)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
  expect(css).toMatch(/\.sk-list__controls\.is-folded > \.sk-list__seg\s*\{\s*display:\s*none/);
});
