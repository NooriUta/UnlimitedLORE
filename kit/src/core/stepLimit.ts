// «Первые N и ещё N» — одна механика на все места, где длинное показывается
// частями (SPRINT_UXR_S9_SCALE_OPT/S9-11, совет kit-сессии: «у них одна форма
// и три числа — общей становится механика, число остаётся у каждого места»).
//
// Ключ — группа (фаза, статус, проект дня…), значение — сколько строк уже
// показано. Шаг задаёт место вызова: у таблиц и ленты это LIST_BUDGET.perGroup.
// Состояние местное: это способ дотянуться, а не вид, которым делятся ссылкой.
import { useCallback, useState } from 'react';

export interface StepLimits {
  /** Сколько строк группы показано сейчас. */
  limitOf: (key: string) => number;
  /** Показать следующий шаг. */
  showMore: (key: string) => void;
}

export function useStepLimits(step: number): StepLimits {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const limitOf = useCallback((k: string) => limits[k] ?? step, [limits, step]);
  const showMore = useCallback((k: string) => setLimits(m => ({ ...m, [k]: (m[k] ?? step) + step })), [step]);
  return { limitOf, showMore };
}
