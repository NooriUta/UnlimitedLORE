// @vitest-environment jsdom
// Мини-версия правой колонки — «только иконками», и это ПРОМЕЖУТОЧНОЕ
// состояние той же границы (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30).
//
// Слова владелицы 09.11.2026, два раза. Сначала: «правое меню не имеет драг анд
// дроп мышкой свернуть развернуть, а так же мини версии как в прототипе при
// полном развороте паспорта только иконками». Потом, уточняя: «не только при
// полном развороте — это промежуточное состояние resizable состояния».
//
// То есть рейка — не отдельный режим паспорта и не кнопка, а СРЕДНЕЕ состояние
// границы: тянешь узко — остаются иконки, тянешь дальше — колонка уходит.
// Прежде такое состояние у левого меню существовало только в переключателе, и
// владелица его «ни разу не получила»: объявлено и недостижимо рукой.
//
// Иконки — её выбор 09.11 («три»): Свойства · Граф · Аналитика.
import { beforeAll, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { RecordView, registerGameIcons } from '../index';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../index';
import type { WidthStore } from '../list/columnWidths';

beforeAll(() => { registerGameIcons(gameIcons); });

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    spec: {
      title: 'Спека', icon: 'scroll-unfurled',
      fields: [{ key: 'ver', title: 'Версия', type: 'text' }, { key: 'owner', title: 'Владелец', type: 'text' }],
    },
  },
  statuses: { items: [{ code: 'accepted', title: 'Принята', category: 'done', icon: 'check-mark', color: 'var(--suc)' }] },
};
const data: KitData = { records: [], edges: [], journal: [], meta: { generated_at: '2026-11-09T00:00:00Z' } };
const record: KitRecord = {
  id: 'SPEC-1', kind: 'spec', title: 'Спека', status: 'accepted',
  fields: { ver: '1.0', owner: 'kit' },
};
const ctx: KitCtx = { config, data, href: id => `#${id}`, esc: s => s, md: s => s };

function mem(initial: Record<string, string> = {}): WidthStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return { map, get: k => map.get(k) ?? null, set: (k, v) => { map.set(k, v); } };
}

/** См. ResizeBorder.test.tsx: PointerEvent в jsdom нет, координаты несёт MouseEvent. */
const drag = (el: HTMLElement, dx: number) => {
  act(() => {
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 600, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 600 + dx, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  });
};

/**
 * Своё хранилище в каждом тесте.
 *
 * Без него RecordView берёт умолчание — localStorage, а он в jsdom ОДИН на
 * весь файл: размер, записанный предыдущим тестом, приезжал в следующий, и
 * «колонка убрана» получалось не от перетаскивания, а от чужого размера.
 * Поймано на этом же файле: тест падал с «кнопки Свойства нет», потому что
 * колонка уже стартовала рейкой и уходила в «скрыто» с первого движения.
 */
const show = (extra: Partial<Parameters<typeof RecordView>[0]> = {}) => render(
  <RecordView
    record={record} ctx={ctx} tab="overview" onTab={() => {}}
    placement="bottom" defaultPropsOpen widthStore={mem()} {...extra}
  />,
);

const propsZone = () => document.querySelector('aside[data-zone="props"]') as HTMLElement | null;
const border = () => screen.getByRole('separator', { name: /Ширина колонки свойств/ });

describe('S4-30 · правая колонка: открыта → только иконки → убрана, одной границей', () => {
  it('положительный контроль: колонка открыта, подписи полей видны', () => {
    show();
    expect(propsZone()).toBeTruthy();
    expect(screen.getByText('Версия')).toBeTruthy();
    expect(propsZone()?.classList.contains('sk-rec__props--rail')).toBe(false);
  });

  it('потянули границу узко — колонка стала рейкой: подписей нет, есть три иконки', () => {
    show();
    // Граница слева от колонки: вправо — сужает (side="after").
    drag(border(), 180);
    expect(propsZone()?.classList.contains('sk-rec__props--rail')).toBe(true);
    // Подписи полей в рейке не обрезаются, а честно отсутствуют.
    expect(screen.queryByText('Версия')).toBeNull();
    for (const name of ['Свойства', 'Граф', 'Аналитика']) {
      expect(screen.getByRole('button', { name }), name).toBeTruthy();
    }
  });

  it('в рейке кнопки — ИКОНКИ, а не подписи: видимого текста нет', () => {
    show();
    drag(border(), 180);
    const btn = screen.getByRole('button', { name: 'Свойства' });
    // Имя для скринридера есть, видимого текста — нет: это и есть «только иконками».
    expect(btn.textContent?.trim()).toBe('');
    expect(btn.querySelector('svg')).toBeTruthy();
  });

  it('из рейки «Свойства» возвращает колонку целиком', () => {
    show();
    drag(border(), 180);
    act(() => { screen.getByRole('button', { name: 'Свойства' }).click(); });
    expect(propsZone()?.classList.contains('sk-rec__props--rail')).toBe(false);
    expect(screen.getByText('Версия')).toBeTruthy();
  });

  it('потянули ещё узже — колонка убрана, на её месте свёрнутая строка', () => {
    show();
    drag(border(), 260);
    expect(propsZone()).toBeNull();
    // Не пустота: свойства стали свёрткой, их видно и можно раскрыть.
    expect(document.querySelector('.sk-rec-propsrow')).toBeTruthy();
  });

  it('личный размер помнит и СОСТОЯНИЕ: запомнили рейку — открылись рейкой', () => {
    // Состояние не хранится отдельно от размера намеренно: две правды о том,
    // «что сейчас с колонкой», разошлись бы первой же правкой.
    const store = mem({ 'kit.cols.w.zones': JSON.stringify({ 'rec.props': 56 }) });
    show({ widthStore: store });
    expect(propsZone()?.classList.contains('sk-rec__props--rail')).toBe(true);
  });

  it('во весь экран рейка у края — те же три иконки, без видимого текста', () => {
    render(<RecordView record={record} ctx={ctx} tab="overview" onTab={() => {}} placement="full" />);
    const rail = document.querySelector('.sk-rec-rail') as HTMLElement;
    expect(rail).toBeTruthy();
    for (const name of ['Свойства', 'Граф', 'Аналитика']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.textContent?.trim(), name).toBe('');
      expect(btn.querySelector('svg'), name).toBeTruthy();
    }
  });
});
