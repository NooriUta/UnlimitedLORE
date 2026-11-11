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

/**
 * Состояние зоны: открыта · только иконки · убрана.
 *
 * Три состояния, а не два, потому что «узкая колонка с обрезанными подписями»
 * — это не состояние, а поломка: либо подписи есть, либо их честно нет и
 * остаются иконки.
 */
export type ZoneLevel = 'open' | 'rail' | 'hidden';

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
  /**
   * Состояния зоны, достигаемые ТОЙ ЖЕ границей (слова владелицы 09.11.2026:
   * «не только при полном развороте — это промежуточное состояние resizable
   * состояния»).
   *
   * Тянем узко — зона просит `rail` (только иконки), ещё узже — `hidden`.
   * Тянем обратно — `open`. Границу между состояниями называет зона: сколько
   * места нужно её иконкам, знает она, а не разделитель.
   *
   * Зачем это здесь, а не кнопкой: до этого рейка существовала только в
   * кнопке-переключателе, и владелица её «ни разу не получила» — состояние
   * было объявлено и недостижимо рукой. Граница видна и под мышью всегда.
   *
   * Не передано — граница меняет только размер (прежнее поведение).
   */
  levels?: {
    /** Уже этого зона показывает только иконки. */
    rail: number;
    /** Уже этого зону лучше убрать совсем. Не задано — до `hidden` не доходим. */
    hide?: number;
    /** Вызывается ОДИН раз на переход, а не на каждое движение мыши. */
    onLevel: (level: ZoneLevel) => void;
  };
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
export function zoneSize(
  store: WidthStore | undefined,
  zone: string,
  fallback: number,
  /**
   * Пределы зоны. Передавать их НУЖНО: хранилище чужое и содержит что угодно —
   * другое приложение на том же домене, прошлая версия, правка руками.
   *
   * Жалоба с прода 09.11.2026 (владелица): «как минимум левое меню глючит и
   * разворачивается во всю стену». Чтение было не ограничено: при
   * перетаскивании пределы соблюдались, а при открытии экрана зона рисовалась
   * тем числом, которое нашла в хранилище.
   */
  bounds?: { min: number; max?: number },
): number {
  const saved = zoneSaved(store, zone);
  if (saved === undefined) return fallback;
  if (!bounds) return saved;
  return Math.max(bounds.min, bounds.max === undefined ? saved : Math.min(bounds.max, saved));
}

/**
 * Запомненный размер или `undefined` — «границу не тянули».
 *
 * Это РАЗНЫЕ состояния, и зоне бывает нужно их различать: пока не тянули,
 * работает правило раскладки (например «паспорт снизу — треть высоты окна»
 * или «справа min(560px, 45%)»), а личный размер его отменяет. Если считать «не тянули» за
 * «поставила умолчание», правило исчезнет у всех, кто границу даже не видел.
 */
export function zoneSaved(store: WidthStore | undefined, zone: string): number | undefined {
  if (!store) return undefined;
  const saved = readWidths(store, ZONES)[zone];
  return typeof saved === 'number' ? saved : undefined;
}

export function ResizeBorder({
  zone, size, min, max, axis = 'x', side = axis === 'y' ? 'after' : 'before', levels, store, label, onSize, className,
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

  /**
   * Состояние зоны по ЖЕЛАЕМОМУ размеру — до ограничения минимумом.
   *
   * Считать по ограниченному нельзя: размер упирается в минимум, и дальше
   * «тяну ещё» перестало бы что-либо значить — ровно та дорога, по которой
   * рейка оказывалась недостижимой.
   */
  const levelOf = (wanted: number): ZoneLevel => {
    if (!levels) return 'open';
    if (levels.hide !== undefined && wanted < levels.hide) return 'hidden';
    return wanted < levels.rail ? 'rail' : 'open';
  };
  const levelNow = useRef<ZoneLevel>(levelOf(size));
  const sayLevel = (wanted: number): void => {
    if (!levels) return;
    const next = levelOf(wanted);
    // Один раз на переход: иначе зона перерисовывается на каждый пиксель.
    if (next === levelNow.current) return;
    levelNow.current = next;
    levels.onLevel(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>): void => {
    e.preventDefault();
    const from = axis === 'y' ? e.clientY : e.clientX;
    const was = size;
    let last = was;
    const move = (ev: Event): void => {
      const at = axis === 'y' ? (ev as globalThis.PointerEvent).clientY : (ev as globalThis.PointerEvent).clientX;
      if (!Number.isFinite(at)) return;
      const wanted = was + dir * (at - from);
      sayLevel(wanted);
      last = fit(wanted);
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
    let wanted: number | null = null;
    if (e.key === forward) wanted = live.current + dir * STEP;
    else if (e.key === back) wanted = live.current - dir * STEP;
    else if (e.key === 'Home') wanted = min;
    else if (e.key === 'End' && max !== undefined) wanted = max;
    if (wanted === null) return;
    e.preventDefault();
    // Состояния зоны доступны и с клавиатуры: управление, которое есть только
    // под мышью, для части людей просто отсутствует.
    sayLevel(wanted);
    const next = fit(wanted);
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
