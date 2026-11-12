// Ссылки из паспорта: связи, граф, чипы шапки (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29, 53а).
//
// kit зовёт `ctx.href(id)` БЕЗ типа. Тип знают только загруженные записи
// (`knownRecordHref`) — а у чипов проектов и компонентов в шапке записи нет:
// это значения `values.projects` / `values.components`. Поэтому чип вёл на
// «#код», то есть в никуда, хотя у проекта (теперь) и у компонента есть свой
// паспорт. Правило одно на все чипы: чип открывает паспорт СВОЕГО типа, тип
// берётся из того, в каком поле чип пришёл, а не угадывается по виду кода.
import { recordHref, knownRecordHref } from '../nav/loreRoutes';

/** Поле значений паспорта → тип записи его чипов. */
const CHIP_FIELDS: Readonly<Record<string, string>> = {
  projects: 'project',
  components: 'component',
  // S4-PRODUCTS-NODE: чип продукта (у компонента — IN_PRODUCT) открывает паспорт продукта.
  products: 'product',
};

/** Код чипа: объект `{id}` (форма S4-29) или строка (прежняя форма). */
function chipId(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') return (v as { id: string }).id || null;
  return null;
}

export function passportHref(
  records: readonly { id: string; kind?: unknown }[],
  values: Readonly<Record<string, unknown>>,
  fallback: (id: string) => string,
): (id: string) => string {
  const chipType = new Map<string, string>();
  for (const [field, type] of Object.entries(CHIP_FIELDS)) {
    const v = values[field];
    for (const x of Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]) {
      const id = chipId(x);
      if (id && !chipType.has(id)) chipType.set(id, type);
    }
  }
  return id => {
    const t = chipType.get(id);
    return (t && recordHref(t, id)) || knownRecordHref(id, records, fallback);
  };
}
