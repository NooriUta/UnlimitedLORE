// @vitest-environment jsdom
// Строка активных фильтров — в одну строку со свёрткой «+N»
// (SPRINT_UXR_S9_SCALE_OPT/S9-12).
//
// Повод: при пяти и более активных условиях строка-описание переносится на
// несколько строк и выдавливает сам список вниз — на 412 px особенно.
//
// Число показанных чипов — ПОРОГ, а не расчёт по ширине: измерять ширину в
// jsdom нечем, а правило должно быть проверяемым. Порог один на оба размера
// экрана и живёт в одном месте (`CHIPS_INLINE`); если владелице захочется
// другое число, меняется одна строка.
//
// Главное в поведении: свёрнутые условия не исчезают. «+N» раскрывает их на
// месте, а не уводит в другое окно, и каждое по-прежнему снимается по одному —
// иначе «что сейчас отсеивает записи» перестанет быть видно, а это и есть
// смысл строки-описания (S4-04).
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { ListView } from './ListView';
import { CHIPS_INLINE } from './listModel';
import type { KitConfig, KitData, KitRecord } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

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
        { key: 'project', title: 'Проект', type: 'ref' },
        { key: 'components', title: 'Компоненты', type: 'ref' },
        { key: 'release', title: 'Релиз', type: 'ref' },
        { key: 'milestone', title: 'Веха', type: 'ref' },
        { key: 'priority', title: 'Приоритет', type: 'ref' },
      ],
    },
  },
  list: { views: ['list'], filters: ['project', 'components', 'release', 'milestone', 'priority'], columns: ['title'] },
};

/** n активных условий фильтра плюс текст — чипов получается n + 1. */
const show = (n: number) => {
  const keys = ['project', 'components', 'release', 'milestone', 'priority'].slice(0, n);
  const filters = Object.fromEntries(keys.map((k, i) => [k, [`${k === 'priority' ? 'P0' : k[0].toUpperCase() + i}`]]));
  return render(
    <ListView
      config={config} data={data}
      state={{ view: 'list', quick: null, group: null, sort: null, filters, ops: {}, text: 'искомое' }}
      onStateChange={() => {}}
    />,
  );
};

const chips = () => [...document.querySelectorAll('.sk-pill--filter')];
// Кнопка свёртки меняет подпись («+N условий» ↔ «Свернуть условия»), поэтому
// ищем её по месту, а не по тексту: иначе после раскрытия она «теряется».
const moreBtn = () => document.querySelector('.sk-list__chipmore') as HTMLButtonElement | null;

describe('S9-12 · строка условий в одну строку', () => {
  it('положительный контроль: одно условие и текст — видны оба чипа', () => {
    show(1);
    expect(chips().length).toBe(2);
    expect(moreBtn()).toBeNull();
  });

  it('условий больше порога — показан порог и кнопка «+N», а не перенос строки', () => {
    show(5);
    expect(chips().length).toBe(CHIPS_INLINE);
    expect(moreBtn()).toBeTruthy();
  });

  it('«+N» называет ЧИСЛО спрятанных условий — иначе непонятно, сколько скрыто', () => {
    show(5);
    // Пять полей плюс текст = шесть условий; показано CHIPS_INLINE.
    expect(moreBtn()?.textContent).toContain(String(6 - CHIPS_INLINE));
  });

  it('«+N» раскрывает спрятанное на месте, и каждое условие по-прежнему снимается', () => {
    show(5);
    fireEvent.click(moreBtn()!);
    expect(chips().length).toBe(6);
    // Снять можно любое — в том числе бывшее спрятанным.
    expect(document.querySelectorAll('.sk-pill--filter button').length).toBeGreaterThanOrEqual(6);
  });

  it('раскрыли и свернули — вернулся порог', () => {
    show(5);
    fireEvent.click(moreBtn()!);
    fireEvent.click(moreBtn()!);
    expect(chips().length).toBe(CHIPS_INLINE);
  });

  it('порог назван числом в одном месте и он небольшой — иначе «одна строка» не держится', () => {
    expect(CHIPS_INLINE).toBeGreaterThan(1);
    expect(CHIPS_INLINE).toBeLessThan(5);
  });
});
