// Справочники для строки задачи (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-36).
//
// Срез `dictionary` отдаёт свои имена полей — label_ru / label_en, sort_order,
// is_active, — а kit принимает статью в своей форме (code, title, icon,
// color). Перевод живёт здесь, в приложении: kit не знает ни про срезы, ни
// про их имена полей.
//
// ВРЕМЕННЫЙ ИСТОЧНИК. Когда поедет общая модель (ADR «одна модель LORE»),
// статьи придут внутри неё уже в нужной форме, и этот файл сведётся к одной
// строке — чтению dictionaries из модели. Отрисовка в kit не изменится.
import type { KitDictItem, KitLang } from '@seidr/kit';

export interface DictApiRow {
  dict_type?: string | null;
  code?: string | null;
  label_ru?: string | null;
  label_en?: string | null;
  icon?: string | null;
  color?: string | null;
  sort_order?: number | null;
  is_active?: boolean | null;
  [k: string]: unknown;
}

/** Загрузчик среза: тот же, что у остальных вкладок. */
export type DictLoader = (slice: string, params: Record<string, string>) => Promise<unknown>;

export interface TaskDicts {
  taskType?: KitDictItem[];
  workClass?: KitDictItem[];
}

function rowsOf(body: unknown): DictApiRow[] {
  if (Array.isArray(body)) return body as DictApiRow[];
  const rows = (body as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as DictApiRow[]) : [];
}

/**
 * Строки среза → статьи kit, в порядке словаря.
 *
 * Снятые статьи (`is_active: false`) НЕ выбрасываются: запись с таким
 * значением существует, и показать её надо как есть. Прятать статью — значит
 * превратить настоящее значение в «нет в словаре».
 */
export function toDictItems(rows: readonly DictApiRow[], lang: KitLang): KitDictItem[] {
  return [...rows]
    .filter(r => typeof r.code === 'string' && r.code)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.code).localeCompare(String(b.code)))
    .map(r => {
      const title = (lang === 'en' ? r.label_en : null) ?? r.label_ru ?? String(r.code);
      const item: KitDictItem = { code: String(r.code), title };
      if (r.icon) item.icon = r.icon;
      if (r.color) item.color = r.color;
      return item;
    });
}

/**
 * Справочники типа задачи и класса работы.
 *
 * Сбой — это не ошибка вкладки: без словаря строка показывает исходные коды и
 * ничего о них не утверждает (kit различает «словаря нет» и «значения нет в
 * словаре»). Ронять список задач из-за иконок было бы несоразмерно.
 */
export async function loadTaskDicts(lang: KitLang, load: DictLoader): Promise<TaskDicts> {
  try {
    const [type, cls] = await Promise.all([
      load('dictionary', { dict_type: 'task_type' }),
      load('dictionary', { dict_type: 'work_class' }),
    ]);
    return { taskType: toDictItems(rowsOf(type), lang), workClass: toDictItems(rowsOf(cls), lang) };
  } catch {
    return {};
  }
}
