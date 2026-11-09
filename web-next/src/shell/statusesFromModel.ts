// Словарь статусов из модели LORE → словарь конфига kit
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG).
//
// **Почему это существует.** Словарь статусов жил рукописным списком в
// `v2Config.STATUSES`, и 09.11 это стоило нам находки аудита: четыре кода
// (`partial`, `ready_for_deploy`, `design`, `deferred`) в список не попали, и у
// 89 задач корпуса чип выходил пустым. Владелица на разбор: «зачем тебе словарь
// статусов на своей стороне, если это задача уже конкретного приложения… я
// думала, для этого отдельный элемент модели будет».
//
// Элемент модели существует. Форма сверена по коду сервера
// (`LoreModel.statusEntry`), а не по переписке: `{code, title, title_en, icon,
// color, order, category, allow, in_dictionary, in_lifecycle, active}`. Цвет
// приходит ТОКЕНОМ (`var(--wrn)`), не hex.
//
// **Главное правило здесь — ничего не выдумывать.** `icon` и `color` могут быть
// `null` (статуса нет в справочнике). Подставить «похожий» цвет нельзя: цвет
// статуса несёт смысл, и зелёное «готово» против серого «готово» — разные
// утверждения. Поэтому нет цвета — нейтральный токен и предупреждение словами.
import type { KitConfig } from '@seidr/kit';

type Items = KitConfig['statuses']['items'];
type Item = Items[number];
type Category = Item['category'];

export interface StatusesFromModel {
  items: Items;
  /** Что пришлось подставить или пропустить — словами, для показа и для лога. */
  warnings: string[];
}

const obj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Цвет только токеном: правило владелицы «никаких сырых hex» держится и здесь. */
const TOKEN_RE = /^var\(--[A-Za-z][\w-]*\)$/;

/** Нейтральные умолчания: видно, что значение не названо, и ничего не придумано. */
const NO_COLOR = 'var(--t3)';
const NO_ICON = 'help';

/** Категории оси kit; незнакомую не выдумываем — ближе всего «неизвестно». */
const CATEGORIES: readonly string[] = ['todo', 'active', 'done', 'cancelled', 'unknown'];
const categoryOf = (v: unknown): Category => {
  const c = str(v);
  if (CATEGORIES.includes(c)) return c as Category;
  // Ось модели шире оси kit (D-2026-UXR-STATUS-AXIS, шесть значений против
  // четырёх) — сведение осей идёт отдельным шагом этой же задачи. Пока
  // незнакомая категория не ломает экран и не притворяется знакомой.
  if (c === 'in_progress' || c === 'in_force') return 'active' as Category;
  if (c === 'not_started') return 'todo' as Category;
  if (c === 'finished') return 'done' as Category;
  if (c === 'withdrawn') return 'cancelled' as Category;
  return 'unknown' as Category;
};

/**
 * Статьи словаря статусов для типа (например `task_status`) из документа
 * модели. Порядок — по `order` модели: он часть словаря, а не наша выдумка.
 */
export function statusesFromModel(model: unknown, dict: string): StatusesFromModel {
  const warnings: string[] = [];
  const statuses = obj(obj(model).statuses);
  if (Object.keys(statuses).length === 0) {
    warnings.push('в модели нет раздела statuses — словарь статусов взят из умолчания приложения');
    return { items: [], warnings };
  }
  const block = obj(statuses[dict]);
  const rows = Array.isArray(block.entries) ? block.entries : null;
  if (!rows) {
    warnings.push(`в модели не описан словарь «${dict}» — статусы этого типа взяты из умолчания приложения`);
    return { items: [], warnings };
  }

  const items: Item[] = [];
  for (const raw of rows) {
    const e = obj(raw);
    const code = str(e.code);
    if (!code) {
      warnings.push('в словаре модели есть статья без кода — пропущена');
      continue;
    }
    const color = str(e.color);
    const icon = str(e.icon);
    if (!color) warnings.push(`у статуса «${code}» в модели не задан цвет — показан нейтральным`);
    else if (!TOKEN_RE.test(color)) warnings.push(`у статуса «${code}» цвет «${color}» не токен — показан нейтральным`);
    if (!icon) warnings.push(`у статуса «${code}» в модели не задан значок — показан общим`);

    const item: Item = {
      code,
      title: str(e.title) || code,
      category: categoryOf(e.category),
      icon: icon || NO_ICON,
      color: color && TOKEN_RE.test(color) ? color : NO_COLOR,
      ...(Array.isArray(e.allow) ? { allow: e.allow.map(String) } : {}),
    };
    items.push(item);
  }

  // Порядок словаря — часть словаря. `order` может не прийти: такие статьи
  // уходят в конец, сохраняя взаимный порядок ответа.
  const orderOf = (raw: unknown): number => {
    const v = obj(raw).order;
    return typeof v === 'number' ? v : Number.MAX_SAFE_INTEGER;
  };
  const byCode = new Map(rows.map(r => [str(obj(r).code), orderOf(r)]));
  items.sort((a, b) => (byCode.get(a.code) ?? 0) - (byCode.get(b.code) ?? 0));

  return { items, warnings };
}
