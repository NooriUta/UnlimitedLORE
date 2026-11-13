// Схема ссылок редактора (K-14, SPRINT_UXR_S7B_ADMIN/S7B-23_2). Ссылки на записи
// внутри тела (актор, спринт, задача) и упоминание «@имя» пишутся адресом со своей
// схемой. Какая это схема, решает приложение: у LORE — «lore:», и в телах записей
// такие ссылки уже лежат. У kit — нейтральная «ref:»; приложение ставит свою один
// раз при старте, до создания редакторов (расширения фиксируются при создании).

export interface LinkScheme {
  /** Схемы адресов, которые редактор не отбрасывает (кроме http/https/mailto). */
  protocols: string[];
  /** Адрес упоминания «@имя» по id актора. */
  mentionHref: (id: string) => string;
}

const DEFAULT_SCHEME: LinkScheme = {
  protocols: ['ref'],
  mentionHref: id => `ref:actor/${id}`,
};

let current: LinkScheme = DEFAULT_SCHEME;

/** Назвать схему приложения. */
export function setLinkScheme(s: Partial<LinkScheme>): void {
  current = { ...current, ...s };
}

/** Вернуть схему kit (тесты, смена приложения). */
export function resetLinkScheme(): void {
  current = DEFAULT_SCHEME;
}

export function linkScheme(): LinkScheme {
  return current;
}
