// Числа и даты интерфейса — одно место (ревью владелицы 10.11.2026, UX-долг).
//
// Повод: «6,44» рядом с «0.375» на одном экране. Разнобой пошёл не от опечаток,
// а от того, что каждый экран заводил свой `Intl.NumberFormat` и резал дату
// `slice(0, 10)` на месте. Пока правило не живёт в одном модуле, следующий
// экран выберет своё написание — поэтому рядом стоит сторож (fmtValue.test.ts).
//
// Намеренное исключение: ПОЛЕ ПРАВКИ показывает число так, как его можно
// ввести (точка), а не так, как его читают (запятая). Иначе человек видит
// «12,5», вводит «12,5» и получает отказ разбора.

/** Язык интерфейса kit: «ru» или любой другой — английский. */
function locale(lang: string): string {
  return lang === 'ru' ? 'ru-RU' : 'en-US';
}

/**
 * Число для ЧТЕНИЯ: разделитель по языку, не больше двух знаков после запятой,
 * целое — без лишних нулей. 12 → «12», 12.5 → «12,5», 0.375 → «0,38».
 */
export function kitNumber(lang: string, value: number): string {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(value);
}

/**
 * То же, но из неизвестного значения: НЕ число — `null`, а не «0».
 * «Не заполнено» и «ноль» — разные вещи, и выдумывать цифру нельзя.
 */
export function kitNumberOf(lang: string, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return kitNumber(lang, value);
}

/** Отметка времени, разобранная для показа. `ok: false` — «прислали не дату». */
export interface KitTime {
  /** Что показать в строке. */
  text: string;
  /** Что показать подсказкой: полная отметка, как её дал сервер. */
  title: string;
  /** Разобрали ли отметку как дату. */
  ok: boolean;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

function parse(iso: string | null | undefined): { raw: string; m: RegExpMatchArray | null } | null {
  if (iso == null) return null;
  const raw = String(iso).trim();
  if (!raw) return null;
  return { raw, m: raw.match(ISO_DAY) };
}

/**
 * День из отметки времени: «2026-11-10», подсказка — отметка целиком.
 *
 * Пусто (нет значения, пустая строка) — `null`: пусть вызывающий скажет «не
 * заполнено», а не покажет «1970-01-01». Непонятная строка — показываем КАК
 * ПРИСЛАЛИ и помечаем `ok: false`: «дату не разобрали» ≠ «даты нет».
 */
export function kitDay(iso: string | null | undefined): KitTime | null {
  const p = parse(iso);
  if (!p) return null;
  if (!p.m) return { text: p.raw, title: p.raw, ok: false };
  return { text: `${p.m[1]}-${p.m[2]}-${p.m[3]}`, title: p.raw, ok: true };
}

/**
 * День и минуты: «2026-11-10 09:31». Без «T» и без миллисекунд — их читают
 * машины, а не люди; полная отметка остаётся в подсказке.
 */
export function kitMinute(iso: string | null | undefined): KitTime | null {
  const p = parse(iso);
  if (!p) return null;
  if (!p.m) return { text: p.raw, title: p.raw, ok: false };
  const day = `${p.m[1]}-${p.m[2]}-${p.m[3]}`;
  const time = p.m[4] ? ` ${p.m[4]}:${p.m[5]}` : '';
  return { text: day + time, title: p.raw, ok: true };
}
