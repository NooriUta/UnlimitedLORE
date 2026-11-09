// Граница между блоками, которую можно потянуть
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30, S4-MENU-STATES, S4-17).
//
// Повод — владелица 09.11.2026: «левое, правое меню не имеет драг анд дроп
// мышкой свернуть развернуть», и позже прямо: «надеюсь что ресайзбл границы
// между блоками вы все же доделаете».
//
// ОДИН МЕХАНИЗМ НА ВСЕ ЗОНЫ — это и есть смысл файла. Требование было разложено
// по разным задачам, и вышло разное поведение: у колонок таблицы ширина
// тянется (S4-35), у меню только переключение состояний, у правой колонки и
// нижнего дока ничего. Снаружи это читается не как «разные задачи», а как
// «где-то работает, где-то нет», и каждый раз надо угадывать. Поэтому здесь
// ровно один разделитель, а левое меню, правая колонка и нижний док — его
// потребители.
//
// ЗНАНИЯ О ПРЕДМЕТЕ ЗДЕСЬ НЕТ (K-14): зона называется строкой, минимум и
// максимум приходят снаружи. Что такое «левое меню», знает приложение.
//
// ХРАНЕНИЕ — то же, что у колонок (`list/columnWidths`): личное, не в адресе,
// и записывается ОДИН раз по отпусканию. Размер зоны ровно так же личный, как
// ширина колонки («ширина личная, набор командный», решение владелицы 08.11),
// и второе хранилище значило бы два разных ответа на вопрос «где мой размер».
//
// КЛАВИАТУРА ЕСТЬ — в отличие от ручки ширины колонки, которая умеет только
// мышь и поэтому помечена aria-hidden. Граница зоны прячет целый блок, и
// оставить её только для мыши значит отнять блок у тех, кто без мыши.
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { clampWidth, readWidths, writeWidths, type WidthStore } from '../list/columnWidths';

/**
 * Все размеры зон лежат под одним ключом хранилища: их мало, они читаются
 * вместе при открытии оболочки, и отдельные ключи означали бы столько же
 * обращений, сколько зон.
 */
const ZONES = 'zones';

/** Шаг стрелкой. Крупнее пикселя — иначе границу клавиатурой не сдвинуть. */
const STEP = 10;

export interface ResizeBorderProps {
  /** Имя зоны в хранилище. Предметное имя даёт приложение. */
  zone: string;
  /** Текущий размер в пикселях: ширина для оси x, высота для оси y. */
  size: number;
  /** Уже этого блок нечитаем. Своё у каждой зоны, поэтому приходит снаружи. */
  min: number;
  /** Больше этого блок съедает содержимое. Не назван — ограничения нет. */
  max?: number;
  /**
   * Ось: `x` — граница стоит вертикально (левое меню, правая колонка), `y` —
   * лежит горизонтально (нижний док).
   */
  axis?: 'x' | 'y';
  /**
   * С КАКОЙ СТОРОНЫ от границы лежит зона, чей размер мы меняем. От этого
   * зависит знак: у левого меню курсор вправо РАСШИРЯЕТ, у правой колонки
   * свойств — наоборот, сужает.
   *
   * Умолчание — по оси, и это не угадывание, а две раскладки оболочки:
   * вертикальная граница по умолчанию принадлежит колонке СЛЕВА (меню),
   * горизонтальная — блоку СНИЗУ (док прижат к низу). Правая колонка и панель
   * справа называют `after` явно.
   */
  side?: 'before' | 'after';
  /** Личное хранилище. Нет — тянуть можно, но размер не переживёт перезагрузку. */
  store?: WidthStore;
  /** Что именно меняет эта граница — вслух, для скринридера. */
  label: string;
  /** Новый размер. Применять его — дело зоны: kit не знает её раскладки. */
  onSize: (size: number) => void;
  className?: string;
}

/**
 * Запомненный размер зоны или умолчание.
 *
 * Нужен зонам при открытии: без него личный размер лежит в хранилище, а на
 * экране умолчание — «я же тянула, и ничего не сохранилось».
 */
export function zoneSize(store: WidthStore | undefined, zone: string, fallback: number): number {
  return zoneSaved(store, zone) ?? fallback;
}

/**
 * Запомненный размер или `undefined` — «границу не тянули».
 *
 * Это РАЗНЫЕ состояния, и зоне бывает нужно их различать: пока не тянули,
 * работает правило раскладки (например «список по содержимому, но не больше
 * 40 % высоты»), а личный размер его отменяет. Если считать «не тянули» за
 * «поставила умолчание», правило исчезнет у всех, кто границу даже не видел.
 */
export function zoneSaved(store: WidthStore | undefined, zone: string): number | undefined {
  if (!store) return undefined;
  const saved = readWidths(store, ZONES)[zone];
  return typeof saved === 'number' ? saved : undefined;
}

export function ResizeBorder({
  zone, size, min, max, axis = 'x', side = axis === 'y' ? 'after' : 'before', store, label, onSize, className,
}: ResizeBorderProps) {
  // Знак: зона «до» границы растёт вслед за курсором, зона «после» — против
  // него. Одно число вместо четырёх ветвей (ось × сторона).
  const dir = side === 'before' ? 1 : -1;
  // Размер во время перетаскивания: между pointermove родитель может ещё не
  // перерисоваться, и считать от props было бы считать от устаревшего.
  const live = useRef(size);
  live.current = size;

  const fit = (value: number): number => {
    const low = clampWidth(zone, value, { [zone]: min });
    if (low === undefined) return size;
    return max === undefined ? low : Math.min(max, low);
  };

  const save = (value: number): void => {
    if (!store) return;
    // Читаем перед записью: под ключом лежат ВСЕ зоны, и запись одной своей
    // пары затёрла бы размеры соседних.
    writeWidths(store, ZONES, { ...readWidths(store, ZONES), [zone]: value });
  };

  const apply = (value: number): void => { live.current = value; onSize(value); };

  const onPointerDown = (e: PointerEvent<HTMLElement>): void => {
    e.preventDefault();
    const from = axis === 'y' ? e.clientY : e.clientX;
    const was = size;
    let last = was;
    const move = (ev: Event): void => {
      const at = axis === 'y' ? (ev as globalThis.PointerEvent).clientY : (ev as globalThis.PointerEvent).clientX;
      if (!Number.isFinite(at)) return;
      last = fit(was + dir * (at - from));
      apply(last);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Запись ОДИН раз: хранилище — не журнал перетаскивания.
      save(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    // Стрелки двигают САМУ ГРАНИЦУ, а не «увеличивают зону»: граница видна, и
    // «вправо» про неё однозначно. Что при этом вырастет — зависит от того, с
    // какой стороны зона, и это уже посчитано в dir.
    const forward = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
    const back = axis === 'y' ? 'ArrowUp' : 'ArrowLeft';
    let next: number | null = null;
    if (e.key === forward) next = fit(live.current + dir * STEP);
    else if (e.key === back) next = fit(live.current - dir * STEP);
    else if (e.key === 'Home') next = fit(min);
    else if (e.key === 'End' && max !== undefined) next = fit(max);
    if (next === null) return;
    e.preventDefault();
    apply(next);
    save(next);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      // Ось x — граница стоит вертикально, и наоборот: ориентация у ARIA про
      // саму черту, а не про направление движения.
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-valuenow={size}
      aria-valuemin={min}
      {...(max === undefined ? {} : { 'aria-valuemax': max })}
      className={['sk-resize', axis === 'y' ? 'sk-resize--y' : 'sk-resize--x', className].filter(Boolean).join(' ')}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
