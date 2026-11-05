/**
 * RM-P11: проверка кода нового типа справочника (`dict_type`) на вкладке
 * «Справочники».
 *
 * Код — ключ, которым связаны данные, и набирается с клавиатуры: строчная
 * латиница, цифры и «_», начинается с буквы. Всё остальное отбивается на вводе
 * — так дешевле, чем переименовывать миграцией потом (RM-X1: «M2 ✓ core»).
 * Совпадение с уже существующим типом — не ошибка и не перезапись: такой тип
 * просто открывается.
 */
export type NewDictTypeCheck =
  | { kind: 'empty' }
  | { kind: 'bad' }
  | { kind: 'exists'; code: string }
  | { kind: 'new'; code: string };

const CODE = /^[a-z][a-z0-9_]*$/;

export function checkNewDictType(raw: string, existing: readonly string[]): NewDictTypeCheck {
  const code = raw.trim();
  if (!code) return { kind: 'empty' };
  if (!CODE.test(code)) return { kind: 'bad' };
  return existing.includes(code) ? { kind: 'exists', code } : { kind: 'new', code };
}
