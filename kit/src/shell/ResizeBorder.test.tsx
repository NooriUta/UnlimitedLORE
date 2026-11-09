// @vitest-environment jsdom
// Граница между блоками тянется мышью — одним механизмом на все зоны
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30, S4-MENU-STATES, S4-17).
//
// Повод — владелица 09.11.2026, дважды: «левое, правое меню не имеет драг анд
// дроп мышкой свернуть развернуть», и позже прямо: «надеюсь что ресайзбл
// границы между блоками вы все же доделаете».
//
// ПОЧЕМУ ОДИН МЕХАНИЗМ, А НЕ ТРИ. Требование было разложено по разным задачам,
// и вышли разные поведения: у колонок таблицы ширина тянется (S4-35), у меню
// только переключение состояний, у правой колонки и нижнего дока — ничего.
// Человек каждый раз угадывает, где что работает. Поэтому разделитель здесь
// ОДИН и переносимый, а зоны — его потребители.
//
// Хранение переиспользует то, что уже работает у колонок (`columnWidths`):
// личный размер, запись ОДИН раз по отпусканию, свой минимум у каждой зоны.
// Второе хранилище значило бы два разных ответа на вопрос «где мой размер».
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ResizeBorder, zoneSize } from './ResizeBorder';

/** Хранилище в памяти — как SafeStorage kit при недоступном localStorage. */
function mem() {
  const map = new Map<string, string>();
  return { map, get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => { map.set(k, v); } };
}

/**
 * Перетаскивание границы.
 *
 * PointerEvent в jsdom нет, и `fireEvent.pointer*` теряет clientX — событие
 * приходит без координат, и проверка молча проходила бы вхолостую (та же
 * ловушка уже описана в `list/colWidthsWired.test.tsx`). Поэтому шлём
 * MouseEvent с типом pointer*: координаты у него есть, а React разбирает его
 * как onPointerDown.
 */
const drag = (el: HTMLElement, dx: number, dy = 0) => {
  act(() => {
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 400, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 + dx, clientY: 400 + dy, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  });
};

type Props = Parameters<typeof ResizeBorder>[0];

const show = (extra: Partial<Props> = {}) => {
  const onSize = vi.fn();
  const store = mem();
  const r = render(
    <ResizeBorder zone="aside" size={280} min={200} store={store} onSize={onSize} label="Ширина панели" {...extra} />,
  );
  return { ...r, onSize, store };
};

const bar = (name?: string) => screen.getByRole('separator', name ? { name } : undefined);

describe('ResizeBorder: граница тянется и запоминается', () => {
  it('положительный контроль: разделитель есть и объявлен значениями', () => {
    show();
    const el = bar('Ширина панели');
    expect(el).toBeTruthy();
    // Для скринридера это ползунок с числами, а не «что-то между блоками».
    expect(el.getAttribute('aria-valuenow')).toBe('280');
    expect(el.getAttribute('aria-valuemin')).toBe('200');
  });

  it('потянули вправо — размер вырос на столько же', () => {
    const { onSize } = show();
    drag(bar(), 60);
    expect(onSize).toHaveBeenLastCalledWith(340);
  });

  it('потянули влево ниже минимума — размер упёрся, а не исчез', () => {
    const { onSize } = show();
    drag(bar(), -500);
    expect(onSize).toHaveBeenLastCalledWith(200);
  });

  it('выше максимума не растёт, если максимум назван', () => {
    const { onSize } = show({ max: 400 });
    drag(bar(), 500);
    expect(onSize).toHaveBeenLastCalledWith(400);
  });

  it('размер пишется В ХРАНИЛИЩЕ один раз — по отпусканию, а не на каждое движение', () => {
    const { store } = show();
    const el = bar();
    act(() => {
      el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, bubbles: true }));
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 180, bubbles: true }));
    });
    // Пока тянут — в хранилище ничего: оно не журнал перетаскивания.
    expect(store.map.size).toBe(0);
    act(() => { window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); });
    expect(store.map.size).toBe(1);
    expect([...store.map.values()].join('')).toContain('360');
  });

  it('зона своя у каждой границы — размеры не перетирают друг друга', () => {
    const store = mem();
    render(<>
      <ResizeBorder zone="aside" size={280} min={200} store={store} onSize={() => {}} label="A" />
      <ResizeBorder zone="dock" size={300} min={120} store={store} onSize={() => {}} label="B" />
    </>);
    drag(bar('A'), 20);
    drag(bar('B'), 40);
    const saved = JSON.parse(store.get('kit.cols.w.zones') ?? '{}') as Record<string, number>;
    expect(saved).toEqual({ aside: 300, dock: 340 });
  });

  it('КЛАВИАТУРА: стрелки двигают границу — иначе её нет для тех, кто без мыши', () => {
    // У ручки ширины колонки (S4-35) клавиатурного управления нет, и она
    // поэтому aria-hidden. Здесь управление есть — значит и объявлено.
    const { onSize } = show();
    const el = bar();
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(onSize).toHaveBeenLastCalledWith(290);
    // Шаги складываются от ПОСЛЕДНЕГО применённого размера, а не от того, что
    // успел дойти обратно свойством: нажатий стрелки бывает несколько подряд,
    // быстрее, чем родитель перерисуется, и иначе зажатая стрелка стояла бы на
    // месте. Поэтому «вправо и влево» возвращает ровно туда, откуда начали.
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(onSize).toHaveBeenLastCalledWith(280);
  });

  it('клавиатурой тоже не ниже минимума', () => {
    const { onSize } = show({ size: 205 });
    fireEvent.keyDown(bar(), { key: 'ArrowLeft' });
    expect(onSize).toHaveBeenLastCalledWith(200);
  });

  it('Home и End — к минимуму и к максимуму, если максимум назван', () => {
    const { onSize } = show({ max: 600 });
    const el = bar();
    fireEvent.keyDown(el, { key: 'End' });
    expect(onSize).toHaveBeenLastCalledWith(600);
    fireEvent.keyDown(el, { key: 'Home' });
    expect(onSize).toHaveBeenLastCalledWith(200);
  });

  it('размер с клавиатуры тоже запоминается — иначе он живёт только до перезагрузки', () => {
    const { store } = show();
    fireEvent.keyDown(bar(), { key: 'ArrowRight' });
    expect(JSON.parse(store.get('kit.cols.w.zones') ?? '{}')).toEqual({ aside: 290 });
  });

  it('зона СПРАВА от границы растёт против курсора — иначе правая колонка сужалась бы', () => {
    // Правая колонка свойств (S4-30): её граница слева, и тянуть её влево
    // значит расширять колонку. Без этого знака жест работал бы наоборот —
    // то есть «драг есть, но делает не то».
    const { onSize } = show({ side: 'after' });
    drag(bar(), -40);
    expect(onSize).toHaveBeenLastCalledWith(320);
  });

  it('у зоны справа и стрелки читаются как движение границы, а не размера', () => {
    const { onSize } = show({ side: 'after' });
    fireEvent.keyDown(bar(), { key: 'ArrowLeft' });
    expect(onSize).toHaveBeenLastCalledWith(290);
  });

  it('вертикальная граница (нижний док) считает по Y, а не по X', () => {
    const { onSize } = show({ axis: 'y', size: 300, min: 120 });
    // Док внизу: курсор идёт ВВЕРХ (y меньше) — док становится выше.
    drag(bar(), 0, -60);
    expect(onSize).toHaveBeenLastCalledWith(360);
  });

  it('хранилища нет (приватный режим) — тянуть можно, просто не запомнится', () => {
    const { onSize } = show({ store: undefined });
    drag(bar(), 30);
    expect(onSize).toHaveBeenLastCalledWith(310);
  });

  it('прочитать запомненный размер можно тем же ключом, что писали', () => {
    // Иначе зона при открытии берёт умолчание, а в хранилище лежит личный
    // размер: «я же тянула» — и ничего не сохранилось.
    const store = mem();
    store.set('kit.cols.w.zones', JSON.stringify({ aside: 330 }));
    expect(zoneSize(store, 'aside', 280)).toBe(330);
    expect(zoneSize(store, 'dock', 240)).toBe(240);
    expect(zoneSize(undefined, 'aside', 280)).toBe(280);
  });
});
