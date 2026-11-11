// Разбор классов для сверки «единого CSS-слоя» (S4-00e): какие классы у
// seidr.css есть в селекторах и какие стоят в разметке.

/** Классы, упомянутые в селекторах CSS (`.x` в любом месте селектора). */
export function definedClasses(text: string): Set<string> {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
  // Только селекторы: тела правил ({…}) отрезаются, иначе `.5s` или `.04em`
  // из значений приняли бы за класс. Тело правила — САМЫЙ ВНУТРЕННИЙ блок, и
  // вырезается он ОДИН раз. Прежний цикл «до упора» вырезал и тело @media
  // вместе с селекторами внутри, поэтому класс, чьи правила живут только в
  // медиа-запросе, считался «без правила» (S4-35: .sk-list__p2…p4 — пороги
  // ADR-LORE-049).
  const selectors = noComments.replace(/\{[^{}]*\}/g, ';').replace(/[{}]/g, ';');
  const out = new Set<string>();
  for (const m of selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  return out;
}

/** Классы из атрибутов class="…" HTML-строки. */
export function usedClasses(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) out.add(c);
  }
  return out;
}
