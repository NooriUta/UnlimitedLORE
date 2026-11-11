// Адресат сообщения (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TECH-NOTES) — без React,
// чтобы его могли звать разборщики данных. Механизм показа — techGate.tsx.

/** Кому сообщение: человеку или разработчику. */
export type Audience = 'user' | 'tech';

/**
 * Адресат по тегу. Без тега (и с любым незнакомым значением) — `user`:
 * ошибиться в сторону «показать» безопасно, в сторону «спрятать» — нет.
 */
export function audienceOf(x: { audience?: unknown } | null | undefined): Audience {
  return x != null && x.audience === 'tech' ? 'tech' : 'user';
}

export function isTech(x: { audience?: unknown } | null | undefined): boolean {
  return audienceOf(x) === 'tech';
}
