// Локали Seiðr-kit — свои, не src/i18n v1 (v1 заморожен,
// D-2026-UXR-V2-FOLDER-V1-FROZEN). ru и en обязаны совпадать по ключам
// (i18n.test.ts).
import ru from './ru.json';
import en from './en.json';

export type KitLang = 'ru' | 'en';
export type KitKey = keyof typeof ru;

const DICTS: Record<KitLang, Record<KitKey, string>> = { ru, en };

export function kitT(lang: KitLang, key: KitKey): string {
  return (DICTS[lang] ?? DICTS.ru)[key];
}
