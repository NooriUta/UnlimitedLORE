// Виды полей и их правила — чистые функции без React
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-FIELD-EDITORS, D-2026-LORE-MODEL-FIELD-KINDS).
//
// «Пусто ≠ ноль ≠ не задано» — главное правило: у числа пустое поле — это
// «не задано» (null), а не 0; у логического поля три состояния; у даты зоны
// нет, у даты-времени — есть. Предметных имён здесь нет: какие поля бывают и
// что они значат, знает приложение (K-14).

/** Виды, у которых в kit есть редактор. Остальные рисуются только чтением. */
export const FIELD_KINDS = ['text', 'number', 'boolean', 'date', 'time', 'datetime', 'enum'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Вариант выбора: строкой или парой «значение + подпись». */
export type FieldOption = string | { value: string; label: string };

/**
 * Описание поля. Совместимо с RefFieldDef сессии «MD и супертеги»
 * (key, label, required, options): её карточка «Новый» переходит на эти
 * редакторы без переделки контракта.
 */
export interface FieldEditorDef {
  key: string;
  label: string;
  /** Вид поля из модели. Нет — по вариантам: есть options → enum, иначе text. */
  kind?: string;
  /** block — без него не сохранить; warn — желательно, но можно. */
  required?: 'block' | 'warn';
  options?: readonly FieldOption[];
  /** false — только чтение, даже у знакомого вида. Право решает приложение. */
  editable?: boolean;
}

export function fieldKindOf(def: FieldEditorDef): string {
  if (def.kind) return def.kind;
  return def.options && def.options.length > 0 ? 'enum' : 'text';
}

export function isKnownKind(kind: string): kind is FieldKind {
  return (FIELD_KINDS as readonly string[]).includes(kind);
}

/** Число из поля ввода: пусто — не задано, запятая — десятичная, мусор — отказ. */
export function parseNumberInput(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.trim().replace(',', '.');
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');

/** Смещение зоны строкой: 180 → «+03:00», −330 → «−05:30» (в ISO — дефис). */
export function zoneOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const m = Math.abs(minutes);
  return `${sign}${pad(m / 60)}:${pad(m % 60)}`;
}

/** Местное «ГГГГ-ММ-ДДTчч:мм» + смещение → ISO со смещением. Пусто — не задано. */
export function toZonedIso(local: string, offsetMinutes: number): string | null {
  if (!local) return null;
  const withSec = /T\d{2}:\d{2}$/.test(local) ? `${local}:00` : local;
  return `${withSec}${zoneOffset(offsetMinutes)}`;
}

/** ISO со смещением → значение для поля «дата-время» (местное время той же зоны). */
export function fromZonedIso(iso: unknown): string {
  if (typeof iso !== 'string') return '';
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : '';
}

/** Пусто ли значение для проверки обязательности. 0 и false — заполнено. */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function optionValue(o: FieldOption): string {
  return typeof o === 'string' ? o : o.value;
}
export function optionLabel(o: FieldOption): string {
  return typeof o === 'string' ? o : o.label;
}
