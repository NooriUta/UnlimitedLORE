// Локали Seiðr-kit — свои, не src/i18n v1 (v1 заморожен,
// D-2026-UXR-V2-FOLDER-V1-FROZEN). ru и en обязаны совпадать по ключам и по
// плейсхолдерам {name} (i18n.test.ts).
import ru from './ru.json';
import en from './en.json';

/** Встроенные языки kit. Тип прежний — приложения, которые передают его дальше как 'ru' | 'en', не ломаются. */
export type KitLang = 'ru' | 'en';
/**
 * Код любого языка подписей: встроенный или подключённый приложением своим словарём —
 * registerKitLang (SPRINT_UXR_S15_KIT6/K6-I18N-PLUGGABLE). `string & {}` оставляет подсказку
 * 'ru' | 'en' и не закрывает дорогу чужим языкам (pl…).
 */
export type KitLangCode = KitLang | (string & {});
export type KitKey = keyof typeof ru;

type Dict = Record<KitKey, string>;
const BUILT_IN: Record<'ru' | 'en', Dict> = { ru, en };

/** Подключённые приложением языки: словарь (может быть неполным), откат и локаль дат/чисел. */
interface PluggedLang { dict: Partial<Dict>; fallback: 'ru' | 'en'; locale: string }
const PLUGGED: Record<string, PluggedLang> = {};

/**
 * Словарь приложения поверх строк kit (K-14, SPRINT_UXR_S7B_ADMIN/S7B-23_2).
 * Строки kit нейтральны: kit не знает, что у приложения «спринт», «агент» или
 * какой у него вход. Приложение подставляет свои слова один раз при старте.
 */
const OVERRIDES: Record<string, Partial<Dict>> = { ru: {}, en: {} };

function unknownKeys(strings: object): string[] {
  return Object.keys(strings).filter(k => !(k in BUILT_IN.ru));
}

/** Подставить слова приложения. Неизвестный ключ — отказ: опечатка не проходит молча. */
export function setKitStrings(lang: KitLangCode, strings: Partial<Record<KitKey, string>>): void {
  const unknown = unknownKeys(strings);
  if (unknown.length) throw new Error(`setKitStrings: нет таких строк kit: ${unknown.join(', ')}`);
  Object.assign((OVERRIDES[lang] ??= {}), strings);
}

/**
 * Подключить язык приложения (K6-I18N-PLUGGABLE). Словарь может быть неполным: ключа нет —
 * строка берётся из `fallback` (по умолчанию en) ЯВНО, а не пустой; что не переведено, называет
 * kitLangMissing — приложение держит это своим сторожем. Неизвестный ключ — отказ. Встроенные
 * ru и en так не подменяются: слова приложения поверх них — setKitStrings.
 */
export function registerKitLang(lang: string, dict: Partial<Record<KitKey, string>>,
  opts: { fallback?: 'ru' | 'en'; locale?: string } = {}): void {
  if (lang === 'ru' || lang === 'en') throw new Error(`registerKitLang: «${lang}» встроен в kit — слова приложения задаёт setKitStrings`);
  const unknown = unknownKeys(dict);
  if (unknown.length) throw new Error(`registerKitLang(${lang}): нет таких строк kit: ${unknown.join(', ')}`);
  PLUGGED[lang] = { dict: { ...dict }, fallback: opts.fallback ?? 'en', locale: opts.locale ?? lang };
}

/** Снять подключённый язык (тесты, смена приложения). */
export function unregisterKitLang(lang: string): void {
  delete PLUGGED[lang];
  delete OVERRIDES[lang];
}

/** Ключи kit, которых нет в словаре подключённого языка (они идут откатом). Встроенный или неизвестный язык — пусто. */
export function kitLangMissing(lang: string): KitKey[] {
  const p = PLUGGED[lang];
  if (!p) return [];
  return (Object.keys(BUILT_IN.ru) as KitKey[]).filter(k => !(k in p.dict));
}

/** Локаль дат и чисел для языка: ru-RU, en-US, у подключённого — заданная им. */
export function kitLocale(lang: KitLangCode): string {
  if (lang === 'ru') return 'ru-RU';
  if (lang === 'en') return 'en-US';
  return PLUGGED[lang]?.locale ?? 'ru-RU';
}

/** Словарь языка: встроенный, подключённый (с откатом) или русский для неизвестного. */
function lookup(lang: KitLangCode, key: KitKey): string {
  if (lang === 'ru' || lang === 'en') return BUILT_IN[lang as 'ru' | 'en'][key];
  const p = PLUGGED[lang];
  if (!p) return BUILT_IN.ru[key];
  return p.dict[key] ?? BUILT_IN[p.fallback][key];
}

/** Есть ли у kit такая строка (ключ из данных: код статуса, вид записи…). */
export function hasKitString(key: string): key is KitKey {
  return key in BUILT_IN.ru;
}

/** Вернуть строки kit (для тестов и смены приложения). */
export function resetKitStrings(): void {
  for (const k of Object.keys(OVERRIDES)) OVERRIDES[k] = {};
}

/** Строка локали; vars подставляются в {name}. Неизвестный язык — русский. */
export function kitT(lang: KitLangCode, key: KitKey, vars?: Record<string, string | number>): string {
  const own = (OVERRIDES[lang] ?? (lang in PLUGGED ? {} : OVERRIDES.ru))[key];
  const s = own ?? lookup(lang, key);
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
export function kitPlural(lang: KitLangCode, base: string, n: number, vars?: Record<string, string | number>): string {
  const p = PLUGGED[lang];
  // Подключённый язык без этой формы в словаре — форма и строка языка отката целиком,
  // иначе «few» польского попросил бы у английского форму, которой у него нет.
  if (p && !(`${base}.${pluralForm(lang, n)}` in p.dict)) return kitPlural(p.fallback, base, n, vars);
  const form = pluralForm(lang, n);
  const key = `${base}.${form}` as KitKey;
  const dict: Partial<Dict> = p ? p.dict : lang === 'en' ? BUILT_IN.en : BUILT_IN.ru;
  // Нет нужной формы — берём `.many` как общую: лучше одна грубая форма, чем
  // пустая строка на экране. Отсутствие ключа ловит i18n.test.ts.
  const chosen = key in dict ? key : (`${base}.many` as KitKey);
  return kitT(lang, chosen, { n, ...vars });
}

/**
 * one — «условие», few — «условия», many — «условий». ru и en — свои правила; подключённый
 * язык — по Intl.PluralRules своей локали (у польского 22 — few, 12 — many). Неизвестный — русские.
 */
export function pluralForm(lang: KitLangCode, n: number): 'one' | 'few' | 'many' {
  const abs = Math.abs(Math.trunc(n));
  if (lang === 'en') return abs === 1 ? 'one' : 'many';
  const p = PLUGGED[lang];
  if (p) {
    const r = new Intl.PluralRules(p.locale).select(abs);
    return r === 'one' ? 'one' : r === 'few' ? 'few' : 'many';
  }
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

export * from './lang';
