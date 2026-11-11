// Фильтр по дате — диапазон «с … по …» и быстрые периоды
// (SPRINT_UXR_S10_SEIDR_KIT_2/K2-DATE-RANGE, слово владелицы 11.11.2026: «для
// фильтров в датах давать возможность выбора диапазонов»).
//
// Чистая модель без React. Значение — дни {from, to} (YYYY-MM-DD), любая
// граница может быть открытой; быстрый период хранится ИМЕНЕМ и считается от
// времени источника в момент показа — ссылка «7 дней» завтра значит завтрашние
// семь дней, а не сегодняшние.
//
// Чего здесь нет намеренно (K-14): ни имени поля времени, ни имён параметров
// сервера, ни ключа адреса. Их называет приложение — kit получает их данными.
import type { KitRecord } from '../core/contract';
import { kitT } from '../i18n';
import type { KitKey, KitLang } from '../i18n';
import { fieldValue, valueKey } from './listModel';

/** Зона дня: местная (пояс человека) или UTC — тот же выбор, что у ленты новостей. */
export type DateZone = 'local' | 'utc';
export type DatePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month';
export const DATE_PRESETS: readonly DatePreset[] = ['today', 'yesterday', '7d', '30d', 'month'];

export interface DateRange {
  /** Первый день включительно; null — открыто слева. */
  from: string | null;
  /** Последний день включительно; null — открыто справа. */
  to: string | null;
  /** Быстрый период: задан — границы считаются от «сейчас» источника. */
  preset?: DatePreset;
}

export interface DateRangeValue extends DateRange { zone: DateZone }

export const NO_DATE_RANGE: DateRangeValue = { from: null, to: null, zone: 'local' };

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Настоящий календарный день (2026-13-40 — нет). */
function isDay(s: string): boolean {
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const isPreset = (s: string): s is DatePreset => (DATE_PRESETS as readonly string[]).includes(s);

export function isDateRangeActive(v: DateRange | null | undefined): boolean {
  return !!v && (!!v.preset || v.from !== null || v.to !== null);
}

// ── адрес ──

/**
 * Значение параметра адреса: `2026-11-10..2026-11-11`, открытые `2026-11-10..`
 * и `..2026-11-11`, один день `2026-11-10`, быстрый период именем (`7d`).
 * Не разобрали — null: мусор в адресе не становится фильтром «0 записей».
 */
export function parseDateRangeParam(raw: string | null | undefined): DateRange | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (isPreset(s)) return { from: null, to: null, preset: s };
  if (!s.includes('..')) return isDay(s) ? { from: s, to: s } : null;
  const [a, b, ...rest] = s.split('..');
  if (rest.length) return null;
  const from = a === '' ? null : a;
  const to = b === '' ? null : b;
  if (from === null && to === null) return null;
  if ((from !== null && !isDay(from)) || (to !== null && !isDay(to))) return null;
  if (from !== null && to !== null && from > to) return null;
  return { from, to };
}

export function writeDateRangeParam(v: DateRange): string | null {
  if (v.preset) return v.preset;
  if (v.from === null && v.to === null) return null;
  return `${v.from ?? ''}..${v.to ?? ''}`;
}

/** Ключ зоны рядом с ключом диапазона: `<param>_tz=utc`; местная — по умолчанию, не пишется. */
export const dateZoneParam = (param: string): string => `${param}_tz`;

/** Заплатка адреса для pushUrlState: ключ называет приложение. */
export function dateRangeUrlPatch(param: string, v: DateRangeValue): Record<string, string | null> {
  const value = writeDateRangeParam(v);
  return { [param]: value, [dateZoneParam(param)]: value !== null && v.zone === 'utc' ? 'utc' : null };
}

export function readDateRangeUrl(search: string | URLSearchParams, param: string): DateRangeValue {
  const sp = typeof search === 'string' ? new URLSearchParams(search) : search;
  const r = parseDateRangeParam(sp.get(param));
  const zone: DateZone = sp.get(dateZoneParam(param)) === 'utc' ? 'utc' : 'local';
  return r ? { ...r, zone } : { ...NO_DATE_RANGE, zone };
}

// ── дни и мгновения в зоне ──

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Стенные часы мгновения в поясе — как миллисекунды «будто UTC». */
function wallMs(ms: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
}

const zoneTz = (zone: DateZone, tz: string): string => (zone === 'utc' ? 'UTC' : tz);

/** День мгновения в зоне (YYYY-MM-DD). */
function dayOfMs(ms: number, tz: string): string {
  return new Date(wallMs(ms, tz)).toISOString().slice(0, 10);
}

/** Мгновение начала стенного времени `dayStartWall` в поясе (две итерации — хватает на переходы часов). */
function instantOfWall(wall: number, tz: string): number {
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - (wallMs(guess, tz) - guess);
  return guess;
}

function dayMs(day: string): number {
  const m = DAY_RE.exec(day)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const addDays = (day: string, n: number): string => new Date(dayMs(day) + n * 86_400_000).toISOString().slice(0, 10);

/** Отметка → день в зоне; отметка без времени (только дата) берётся как есть. null — не разобрали. */
function stampDay(stamp: string, tz: string): string | null {
  const s = stamp.trim();
  if (isDay(s)) return s;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : dayOfMs(ms, tz);
}

/**
 * Границы днями: быстрый период — от «сейчас» источника в выбранной зоне.
 * «7 дней» — сегодня и шесть дней до него, «этот месяц» — с первого числа по сегодня.
 */
export function resolveDateRange(v: DateRangeValue, now: string, tz: string): { from: string | null; to: string | null } {
  if (!v.preset) return { from: v.from, to: v.to };
  const today = stampDay(now, zoneTz(v.zone, tz)) ?? new Date().toISOString().slice(0, 10);
  switch (v.preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

/**
 * Попадает ли отметка в диапазон (границы включительно). Неактивный фильтр —
 * true всегда. Нет отметки или не разобрали — null: «не знаем» не равно «нет».
 */
export function inDateRange(stamp: string | null | undefined, v: DateRangeValue, now: string, tz: string): boolean | null {
  if (!isDateRangeActive(v)) return true;
  if (!stamp) return null;
  const day = stampDay(stamp, zoneTz(v.zone, tz));
  if (day === null) return null;
  const r = resolveDateRange(v, now, tz);
  return (r.from === null || day >= r.from) && (r.to === null || day <= r.to);
}

/**
 * Границы мгновениями UTC (ISO, включительно) — то, что приложение отдаёт
 * источнику под своими именами параметров. Открытая граница — null.
 */
export function rangeInstants(v: DateRangeValue, now: string, tz: string): { from: string | null; to: string | null } {
  const r = resolveDateRange(v, now, tz);
  const z = zoneTz(v.zone, tz);
  const at = (day: string) => instantOfWall(dayMs(day), z);
  return {
    from: r.from === null ? null : new Date(at(r.from)).toISOString(),
    to: r.to === null ? null : new Date(at(addDays(r.to, 1)) - 1).toISOString(),
  };
}

/**
 * Фильтр по загруженному: записи, чья отметка в поле `field` попала в
 * диапазон. Записи без отметки не показываются, но СЧИТАЮТСЯ — список говорит
 * «N без времени», а не делает вид, что их не было.
 */
export function filterByDateRange<R extends KitRecord>(
  records: readonly R[], field: string, v: DateRangeValue, now: string, tz: string,
): { records: readonly R[]; undated: number } {
  if (!isDateRangeActive(v)) return { records, undated: 0 };
  let undated = 0;
  const out = records.filter(r => {
    const raw = valueKey(fieldValue(r, field));
    const hit = inDateRange(raw === '' ? null : raw, v, now, tz);
    if (hit === null) undated++;
    return hit === true;
  });
  return { records: out, undated };
}

// ── подпись словами ──
//
// Слова — из локалей kit (kit.date.*), месяц — из Intl в нужном падеже
// («10 ноября», «Nov 10»): своих списков месяцев kit не держит.

const monthCache = new Map<KitLang, Intl.DateTimeFormat>();
function monthOf(day: string, lang: KitLang): string {
  let f = monthCache.get(lang);
  if (!f) {
    f = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { timeZone: 'UTC', day: 'numeric', month: lang === 'ru' ? 'long' : 'short' });
    monthCache.set(lang, f);
  }
  return f.formatToParts(new Date(dayMs(day))).find(p => p.type === 'month')?.value ?? day.slice(5, 7);
}

function dayWords(day: string, lang: KitLang, withYear: boolean): string {
  const [y, , d] = day.split('-').map(Number);
  const vars = { d, month: monthOf(day, lang), y };
  return kitT(lang, withYear ? 'kit.date.dayYear' : 'kit.date.day', vars);
}

/**
 * Чип словами: «10–11 ноября», «с 10 ноября», «по 11 ноября», «за 7 дней».
 * Год пишется, только когда границы в разных годах. `showZone` — дописать
 * «(UTC)»: иначе UTC-день читается местным.
 */
export function describeDateRange(v: DateRangeValue, lang: KitLang, opts: { showZone?: boolean } = {}): string {
  const text = describeBare(v, lang);
  return text && opts.showZone && v.zone === 'utc' ? kitT(lang, 'kit.date.utcSuffix', { text }) : text;
}

function describeBare(v: DateRangeValue, lang: KitLang): string {
  if (v.preset) return kitT(lang, `kit.date.preset.${v.preset}` as KitKey);
  const { from, to } = v;
  if (from && to) {
    if (from === to) return dayWords(from, lang, false);
    if (from.slice(0, 4) !== to.slice(0, 4)) {
      return kitT(lang, 'kit.date.span', { from: dayWords(from, lang, true), to: dayWords(to, lang, true) });
    }
    if (from.slice(0, 7) === to.slice(0, 7)) {
      return kitT(lang, 'kit.date.sameMonth', { a: Number(from.slice(8)), b: Number(to.slice(8)), month: monthOf(from, lang) });
    }
    return kitT(lang, 'kit.date.span', { from: dayWords(from, lang, false), to: dayWords(to, lang, false) });
  }
  if (from) return kitT(lang, 'kit.date.since', { from: dayWords(from, lang, false) });
  if (to) return kitT(lang, 'kit.date.until', { to: dayWords(to, lang, false) });
  return '';
}
