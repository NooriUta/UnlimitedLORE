// Локали Seiðr-kit — свои, не src/i18n v1 (v1 заморожен,
// D-2026-UXR-V2-FOLDER-V1-FROZEN). ru и en обязаны совпадать по ключам и по
// плейсхолдерам {name} (i18n.test.ts).
import ru from './ru.json';
import en from './en.json';

export type KitLang = 'ru' | 'en';
export type KitKey = keyof typeof ru;

const DICTS: Record<KitLang, Record<KitKey, string>> = { ru, en };

/** Строка локали; vars подставляются в {name}. Неизвестный язык — русский. */
export function kitT(lang: KitLang, key: KitKey, vars?: Record<string, string | number>): string {
  const s = (DICTS[lang] ?? DICTS.ru)[key];
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export * from './lang';
