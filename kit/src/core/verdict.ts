// Статья вердикта (SPRINT_UXR_S14_KIT5/K5-VERDICT-CONTRACT).
//
// Провал, подсказка и «не смогли проверить» приходят либо прежней формой — кодом-строкой,
// либо статьёй {code, message}. Код нужен фильтрам и ссылкам, текст — человеку: «quiz»
// на карточке ничего не говорит, «нет квиза по руне темы» — говорит (ADR-LORE-039).
import type { KitVerdictEntry } from './contract';

/** Код статьи — по нему фильтруют и ссылаются. */
export function verdictCode(e: KitVerdictEntry): string {
  return typeof e === 'string' ? e : e.code;
}

/** Текст статьи для человека; нет текста — код, а не пустота. */
export function verdictText(e: KitVerdictEntry): string {
  if (typeof e === 'string') return e;
  const m = e.message?.trim();
  return m ? m : e.code;
}

/** Подсказка при наведении: код, если показан текст; иначе ничего. */
export function verdictHint(e: KitVerdictEntry): string | undefined {
  const text = verdictText(e);
  const code = verdictCode(e);
  return text === code ? undefined : code;
}
