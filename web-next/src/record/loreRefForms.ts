// Тип записи по форме ID — общий для ссылок в тексте (loreMdRefs) и Peek (lorePeek), без цикла импортов.
/**
 * Тип по форме ID, когда ссылка без типа ([[ADR-LORE-050]]). Формы — как у ссылок LORE
 * (splitLoreRefs в miniLORE): ADR-…, SPEC-…, D-ГГГГ-…, SPRINT_X/CODE. Не узнали — null.
 */
export function typeByForm(id: string): string | null {
  if (/^ADR-[A-Z0-9-]*[A-Z0-9]$/i.test(id)) return 'adr';
  if (/^SPEC-[A-Z0-9-]*[A-Z0-9]$/i.test(id)) return 'spec';
  if (/^D-\d{4}-[A-Z0-9-]*[A-Z0-9]$/i.test(id)) return 'decision';
  if (/^SPRINT_[A-Z0-9_]+\/[A-Z0-9-]+$/i.test(id)) return 'task';
  return null;
}
