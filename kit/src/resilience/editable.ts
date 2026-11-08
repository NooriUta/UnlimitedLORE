// «Пользователь набирает текст» — ОДНА проверка на весь kit
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-13, баг B-08 из Q-UXR-4: «/» в TipTap
// открывал палитру).
//
// До этого проверок было три (палитра, useHotkeys, StatusChip), и расходились
// они по существу: одна смотрела только isContentEditable, другая — ещё и
// атрибут contenteditable="true", третья — только теги. Пропуски:
//   • contenteditable="" и "plaintext-only" — валидные «включено», но не "true";
//   • keydown приходит из ВЛОЖЕННОГО узла редактора (абзац ProseMirror), у
//     которого своего атрибута нет — редактируемость унаследована;
//   • поле-виджет с role="textbox"/"searchbox"/"combobox" без contenteditable.
// Поэтому — подъём по предкам до ближайшего явного contenteditable: остров
// contenteditable="false" внутри редактора (кнопка в узле) — не поле.
// isContentEditable не используем как единственный признак: jsdom его не
// реализует, и проверка, которую нельзя проверить тестом, — не проверка.

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox']);
const NON_TEXT_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image']);

function isElement(t: unknown): t is Element {
  return typeof t === 'object' && t !== null && (t as Node).nodeType === 1;
}

export function isEditableTarget(t: EventTarget | null): boolean {
  if (!isElement(t)) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(((t as HTMLInputElement).type || 'text').toLowerCase());
  const role = t.getAttribute('role');
  if (role && TEXT_ROLES.has(role)) return true;
  const host = t.closest('[contenteditable]');
  if (!host) return false;
  return host.getAttribute('contenteditable')?.toLowerCase() !== 'false';
}
