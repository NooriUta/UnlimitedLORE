// Множитель размера текста: границы, шаг и запись в корень (S4-16).
//
// Решение владелицы 10.11.2026, дословно: «вообще ползунок с сохранением
// множителя поставьте в настройках я скажу сколько мин макс оставить после
// выкатки».
//
// Поэтому границы здесь — ОДНО место и прямо названы предварительными: их
// назовёт она по живому виду после выкатки. Менять их надо здесь, а не в
// разметке и не в настройках приложения.
//
// Множитель не заменяет ступени `text_size`, а умножает выбранную: ступень
// задаёт основу (её числа подобраны вручную и остаются как есть), ползунок —
// подгонку поверх. При 1 не меняется ничего.

/** Предварительные границы: владелица назовёт свои после выкатки. */
export const TEXT_SCALE_MIN = 0.8;
export const TEXT_SCALE_MAX = 1.6;

/** Шаг: заметен глазом, но не прыжком. */
export const TEXT_SCALE_STEP = 0.05;

/** Множитель «как есть», выбора не было. */
export const TEXT_SCALE_DEFAULT = 1;

/**
 * Привести значение к допустимому.
 *
 * Значение вне границ ПРИЖИМАЕТСЯ, а не отвергается: человек приедет со старым
 * числом после сужения границ, и отказ он прочтёт как поломку настроек.
 *
 * Непонятное значение (чужая строка, NaN, пусто) — это НЕ «мелко» и не ноль:
 * возвращаем умолчание, то есть «выбора не было».
 */
export function clampTextScale(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return TEXT_SCALE_DEFAULT;
  if (n < TEXT_SCALE_MIN) return TEXT_SCALE_MIN;
  if (n > TEXT_SCALE_MAX) return TEXT_SCALE_MAX;
  // Округление до шага: иначе в настройках копятся числа вида 1.2000000000000002.
  // Округление идёт ЧЕРЕЗ ЦЕЛОЕ число шагов и обрезается до четырёх знаков:
  // «n / 0.05 * 0.05» в двоичной дроби даёт 1.4000000000000001, и такое число
  // уезжает в настройки и в подпись.
  return Number((Math.round(n / TEXT_SCALE_STEP) * TEXT_SCALE_STEP).toFixed(4));
}

/** Куда писать множитель; null — документа нет (сервер, тесты). */
type ScaleTarget = {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
} | null;

/**
 * Записать множитель в корень документа.
 *
 * Умолчание СНИМАЕТ свойство, а не пишет «1»: «выбора не было» и «выбрал 100%»
 * — разные вещи, и по снятому свойству это видно снаружи.
 */
export function applyTextScale(root: ScaleTarget, value: unknown): number {
  const k = clampTextScale(value);
  if (!root) return k;
  if (k === TEXT_SCALE_DEFAULT) {
    root.style.removeProperty('--fs-k');
    root.removeAttribute('data-text-scale');
    return k;
  }
  // Короткая запись числа: 1.25, а не 1.2500000000000002.
  const text = String(Number(k.toFixed(4)));
  root.style.setProperty('--fs-k', text);
  root.setAttribute('data-text-scale', text);
  return k;
}
