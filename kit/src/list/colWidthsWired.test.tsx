// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35, вторая половина: «ширина личная, набор
// командный» (решение владелицы 08.11).
//
// Находка 09.11: модель ширин (columnWidths.ts) была написана и покрыта
// тестами, но НИ ОДИН компонент её не вызывал — `readWidths`/`writeWidths`/
// `widthsFor` не встречались ни в одном .tsx. То есть половина задачи
// существовала как библиотека, а в интерфейсе ширину потянуть было нельзя.
// Это тот же класс, что «вкладка История сделана и не подключена»: выглядит
// как отсутствие возможности.
//
// Что закрепляется:
//   • у заголовка колонки есть ручка, и ширина после перетаскивания
//     применяется к таблице;
//   • ширина переживает перезагрузку (личное хранилище), но в адрес НЕ идёт:
//     ссылка общая, а ширина личная;
//   • уже минимума колонку не сузить — нечитаемая колонка хуже широкой;
//   • на узком экране ширины не применяются вовсе: там карточки;
//   • хранилища нет (приватный режим) — ручка не ломает список, ширина живёт
//     до перезагрузки.
import { beforeAll, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { ListView, MIN_COL_W, registerGameIcons } from '../index';
import type { KitConfig, KitData, WidthStore } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задача', icon: 'checklist' } },
  statuses: { items: [{ code: 'active', title: 'В работе', category: 'in_progress', icon: 'gears', color: 'var(--inf)' }] },
  list: { views: ['list'], columns: ['title+id', 'status', 'kind'] },
};

const data: KitData = {
  records: [
    { id: 'T-1', kind: 'task', title: 'Первая', status: 'active', fields: {} },
    { id: 'T-2', kind: 'task', title: 'Вторая', status: 'active', fields: {} },
  ],
  edges: [], journal: [], meta: { generated_at: '2026-11-09T00:00:00Z' },
};

function memStore(initial: Record<string, string> = {}): WidthStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return { map, get: k => map.get(k) ?? null, set: (k, v) => { map.set(k, v); } };
}

const show = (extra: Partial<Parameters<typeof ListView>[0]> = {}) =>
  render(<ListView config={config} data={data} urlState={false} {...extra} />);

const th = (name: string | RegExp) => within(screen.getByRole('table')).getByRole('columnheader', { name });
// Ручка намеренно aria-hidden: это приспособление для мыши, клавиатурного
// изменения ширины нет, и обещать его подписью нельзя. Поэтому ищем по классу,
// а не по роли.
const handleIn = (el: HTMLElement) => el.querySelector('.sk-list__grip') as HTMLElement;
/**
 * Перетаскивание ручки. PointerEvent в jsdom нет, а fireEvent.pointer* без
 * него теряет clientX — событие приходит без координат, и проверка молча
 * проходила бы «вхолостую». Поэтому шлём MouseEvent с типом pointer*: у него
 * координаты есть, а React разбирает его как onPointerDown.
 */
const drag = (el: HTMLElement, from: number, to: number) => {
  act(() => {
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: from, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: to, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: to, bubbles: true }));
  });
};

describe('S4-35 · личная ширина колонок подключена', () => {
  it('положительный контроль: таблица со колонками нарисована', () => {
    show({ widths: { screen: 'tasks', store: memStore() } });
    expect(th(/Статус/)).toBeTruthy();
  });

  it('у заголовка есть ручка ширины', () => {
    show({ widths: { screen: 'tasks', store: memStore() } });
    expect(handleIn(th(/Статус/))).toBeTruthy();
  });

  it('сохранённая ширина применяется к колонке', () => {
    show({ widths: { screen: 'tasks', store: memStore({ 'kit.cols.w.tasks': JSON.stringify({ status: 180 }) }) } });
    expect(th(/Статус/).style.width).toBe('180px');
  });

  it('перетаскивание меняет ширину и пишет её в личное хранилище', () => {
    const store = memStore();
    show({ widths: { screen: 'tasks', store } });
    const head = th(/Статус/);
    drag(handleIn(head), 100, 220);
    expect(head.style.width).toBe('120px');
    expect(JSON.parse(store.map.get('kit.cols.w.tasks') ?? '{}')).toEqual({ status: 120 });
  });

  it('уже минимума не сузить: нечитаемая колонка хуже широкой', () => {
    const store = memStore();
    show({ widths: { screen: 'tasks', store } });
    const head = th(/Статус/);
    drag(handleIn(head), 100, 10);
    expect(head.style.width).toBe(`${MIN_COL_W}px`);
  });

  it('ширина в адрес не идёт: ссылка общая, ширина личная', () => {
    const store = memStore();
    const win = {
      location: { pathname: '/', search: '', hash: '' },
      history: {
        pushState: (_s: unknown, _t: string, url?: string | URL | null) => { win.location.search = String(url).replace(/^[^?]*/, ''); },
        replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { win.location.search = String(url).replace(/^[^?]*/, ''); },
      },
    };
    show({ widths: { screen: 'tasks', store }, urlState: win });
    drag(handleIn(th(/Статус/)), 100, 200);
    expect(win.location.search).not.toMatch(/w|width/);
  });

  it('узкий экран — ширины не применяются: там карточки', () => {
    show({ widths: { screen: 'tasks', store: memStore({ 'kit.cols.w.tasks': JSON.stringify({ status: 180 }) }), narrow: true } });
    expect(th(/Статус/).style.width).toBe('');
  });

  it('ширин не задано — таблица считает сама, нулями не подменяем', () => {
    show({ widths: { screen: 'tasks', store: memStore() } });
    expect(th(/Статус/).style.width).toBe('');
  });

  it('без настройки ширин ручек нет — показывать то, чем нельзя управлять, незачем', () => {
    show();
    expect(handleIn(th(/Статус/))).toBeNull();
  });
});
