// Граница «модель данных ↔ поведенческая модель» (ADR «одна модель LORE»,
// решение 1; требование владелицы 08.11.2026).
//
// Её формулировка: «модель — это общий контракт, а web-next — поведенческая
// модель». Поэтому документ /lore/model обязан быть данными. Поведение —
// вердикт, хуки, команды палитры, отрисовка обзора и вкладок — остаётся в
// приложении, которое монтирует kit, и в общий контракт не уезжает.
//
// Сторож нужен потому, что пробой не падает сам: функция, приехавшая с
// сервера, тихо работает у одного приложения и отсутствует у другого. kit
// отдаётся наружу (K-08) и запускается без сборки (K-13), так что «у нас
// работает» ничего не доказывает.

/**
 * Имена, которые означают договор о поведении. Проверяются по имени, а не по
 * типу значения: `verdict: "ok"` — такой же договор, как `verdict: () => …`,
 * просто записанный данными.
 */
export const BEHAVIOUR_STAYS_IN_APP: readonly string[] = [
  'verdict',
  'hooks',
  'palette',
  'overview',
  'tabs',
  'render',
  'run',
];

/** Шаг пути: массив — с индексом, объект — через точку. */
function step(path: string, key: string, inArray: boolean): string {
  if (inArray) return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

/**
 * Пути, по которым в документе лежит поведение: функция где угодно либо
 * поведенческое имя из {@link BEHAVIOUR_STAYS_IN_APP}. Путь называется целиком,
 * потому что «где-то в модели функция» нечинибельно.
 */
export function findFunctions(value: unknown, path = ''): string[] {
  if (typeof value === 'function') return [path || '(корень)'];
  if (value === null || typeof value !== 'object') return [];

  const out: string[] = [];
  const arr = Array.isArray(value);
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const here = step(path, key, arr);
    if (!arr && BEHAVIOUR_STAYS_IN_APP.includes(key)) {
      out.push(here);
      continue; // Внутрь не идём: ветка целиком поведенческая.
    }
    out.push(...findFunctions(v, here));
  }
  return out;
}

/**
 * Бросает, если документ несёт поведение. Зовётся на всём, что приехало с
 * сервера как модель, — до того, как из него соберут KitConfig.
 */
export function assertDataOnly(value: unknown, where: string): void {
  const hits = findFunctions(value);
  if (hits.length === 0) return;
  throw new Error(
    `${where}: модель данных не должна нести поведение, а несёт — ${hits.join(', ')}. ` +
    'Вердикт, хуки, команды палитры и отрисовка живут в приложении, не в общем контракте.',
  );
}
