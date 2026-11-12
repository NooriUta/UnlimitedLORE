// Модель «Календаря» — месяц сеткой (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-CALENDAR).
//
// Прототип утверждён владелицей 11.11.2026: «Библиотека и Календарь — два
// общих вида kit, утверждаю». Чистая функция: какой день какие записи получает.
// Какое поле — дата, решает приложение (`list.calendar.date`, K-14).
//
// Правила, закреплённые тестом:
//   • неделя с понедельника; сетка — полные недели вокруг месяца;
//   • дата записи — первые 10 символов поля (YYYY-MM-DD); день считается в UTC,
//     иначе запись «уезжала» бы на соседний день в часовом поясе зрителя;
//   • запись без даты или с неразборчивой датой НЕ теряется — она в `undated`,
//     и вид называет её число;
//   • в клетке видны первые `perDay` записей, остальное — числом «ещё N».
import type { KitRecord } from '../../core/contract';

export interface CalendarDay {
  /** YYYY-MM-DD. */
  date: string;
  /** День этого месяца (а не хвост соседнего). */
  inMonth: boolean;
  records: KitRecord[];
}

export interface CalendarMonthModel {
  /** YYYY-MM. */
  month: string;
  weeks: CalendarDay[][];
  /** Записи без разборчивой даты в поле — их число показывается, они не теряются. */
  undated: KitRecord[];
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Дата записи из поля: YYYY-MM-DD или null. */
export function recordDate(r: KitRecord, field: string): string | null {
  const v = field === 'updated_at' ? r.updated_at : r.fields[field];
  if (typeof v !== 'string') return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? d : null;
}

/** Сдвиг месяца: «2026-11», +1 → «2026-12». */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return iso(d.getTime()).slice(0, 7);
}

/** Самый длинный диапазон, который раскладывается по дням: дальше — неразумные данные, не повод перебирать годы. */
const MAX_SPAN_DAYS = 400;

/**
 * Записи по дням месяца. `endField` — конец диапазона: запись видна в каждом дне
 * от начала до конца включительно. Конец пуст, неразборчив или раньше начала —
 * запись только в дне начала (не теряется и не растягивается назад).
 */
export function calendarMonth(records: readonly KitRecord[], field: string, month: string, endField?: string): CalendarMonthModel {
  const byDay = new Map<string, KitRecord[]>();
  const undated: KitRecord[] = [];
  const put = (d: string, r: KitRecord) => {
    const list = byDay.get(d) ?? [];
    list.push(r);
    byDay.set(d, list);
  };
  for (const r of records) {
    const d = recordDate(r, field);
    if (!d) { undated.push(r); continue; }
    const e = endField ? recordDate(r, endField) : null;
    const from = Date.parse(`${d}T00:00:00Z`);
    const to = e ? Date.parse(`${e}T00:00:00Z`) : from;
    const last = to > from ? Math.min(to, from + MAX_SPAN_DAYS * DAY) : from;
    for (let t = from; t <= last; t += DAY) put(iso(t), r);
  }
  const first = Date.parse(`${month}-01T00:00:00Z`);
  const next = Date.parse(`${shiftMonth(month, 1)}-01T00:00:00Z`);
  // Понедельник = 0.
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const start = first - lead * DAY;
  const weeks: CalendarDay[][] = [];
  for (let t = start; t < next || weeks.length === 0 || weeks[weeks.length - 1].length < 7; t += DAY) {
    if (!weeks.length || weeks[weeks.length - 1].length === 7) {
      if (t >= next) break;
      weeks.push([]);
    }
    const date = iso(t);
    weeks[weeks.length - 1].push({ date, inMonth: t >= first && t < next, records: byDay.get(date) ?? [] });
  }
  return { month, weeks, undated };
}
