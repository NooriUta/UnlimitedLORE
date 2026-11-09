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

/**
 * Числовая форма слова: `ключ.one | .few | .many` (S9-12).
 *
 * Повод — находка CJM на проде 09.11.2026: «+1 условий» вместо «+1 условие».
 * Одна строка с `{n}` для русского не годится: у него три формы, и подставить
 * число в единственную заготовку значит соврать в двух случаях из трёх.
 *
 * Правила выбора формы — по языку, а не по месту вызова: иначе каждое новое
 * «N чего-то» будет склоняться по-своему. Английский берёт `one`/`many`,
 * `few` для него просто не определяют.
 */
export function kitPlural(lang: KitLang, base: string, n: number, vars?: Record<string, string | number>): string {
  const form = pluralForm(lang, n);
  const key = `${base}.${form}` as KitKey;
  const dict = DICTS[lang] ?? DICTS.ru;
  // Нет нужной формы — берём `.many` как общую: лучше одна грубая форма, чем
  // пустая строка на экране. Отсутствие ключа ловит i18n.test.ts.
  const chosen = key in dict ? key : (`${base}.many` as KitKey);
  return kitT(lang, chosen, { n, ...vars });
}

/** one — «условие», few — «условия», many — «условий». */
export function pluralForm(lang: KitLang, n: number): 'one' | 'few' | 'many' {
  const abs = Math.abs(Math.trunc(n));
  if (lang === 'en') return abs === 1 ? 'one' : 'many';
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

export * from './lang';
