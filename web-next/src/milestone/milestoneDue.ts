// Срок вехи из её «Когда» (date_display) — для «Цели к сроку» (PU-27).
//
// У вехи нет поля-даты: «Когда» — свободный текст («прогноз Q4 2026»,
// «прогноз Q1–Q2 2027», «авг 2026 (заморожена)», «18 апр»). Правило:
//   • дата ГГГГ-ММ-ДД или «ДД месяц ГГГГ» — этот день;
//   • квартал «Qn ГГГГ» — конец квартала; в диапазоне — конец ПОСЛЕДНЕГО;
//   • «месяц ГГГГ» — конец месяца (последнего в диапазоне);
//   • года нет («18 апр», «Ноя+») — срока нет (null), и это говорится словами:
//     угадать год значило бы выдумать прогноз;
//   • «заморожена»/«закрыта» — историческая веха: прогноза у неё нет вовсе.

export interface MilestoneDue {
  /** Срок ГГГГ-ММ-ДД; null — в «Когда» срока не распознали. */
  due: string | null;
  /** Историческая веха (заморожена/закрыта): без прогноза. */
  frozen: boolean;
}

const FROZEN = /заморож|закрыт|frozen|closed/i;

/** Месяц по началу слова: «янв», «январь», «мая», «июль»… */
const MONTHS: readonly [RegExp, number][] = [
  [/^янв/, 1], [/^фев/, 2], [/^мар/, 3], [/^апр/, 4], [/^ма[йя]/, 5], [/^июн/, 6],
  [/^июл/, 7], [/^авг/, 8], [/^сен/, 9], [/^окт/, 10], [/^ноя/, 11], [/^дек/, 12],
  [/^jan/, 1], [/^feb/, 2], [/^mar/, 3], [/^apr/, 4], [/^may/, 5], [/^jun/, 6],
  [/^jul/, 7], [/^aug/, 8], [/^sep/, 9], [/^oct/, 10], [/^nov/, 11], [/^dec/, 12],
];

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function monthOf(word: string): number | null {
  const w = word.toLowerCase();
  for (const [re, m] of MONTHS) if (re.test(w)) return m;
  return null;
}

export function milestoneDue(when: string | null | undefined): MilestoneDue {
  const text = (when ?? '').trim();
  const frozen = FROZEN.test(text);
  if (!text) return { due: null, frozen };

  const isoDate = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDate) return { due: isoDate[0], frozen };

  const years = [...text.matchAll(/\b(20\d{2})\b/g)];
  if (!years.length) return { due: null, frozen };
  const year = Number(years[years.length - 1][1]);

  const quarters = [...text.matchAll(/Q([1-4])/gi)];
  if (quarters.length) {
    const q = Number(quarters[quarters.length - 1][1]);
    return { due: iso(year, q * 3, lastDay(year, q * 3)), frozen };
  }

  // Слова-месяцы по порядку; последний — конец срока. «ДД месяц» — день этого месяца.
  const words = [...text.matchAll(/(?:(\d{1,2})\s+)?([A-Za-zА-Яа-яЁё]+)/g)];
  let found: { m: number; d: number | null } | null = null;
  for (const w of words) {
    const m = monthOf(w[2]);
    if (m) found = { m, d: w[1] ? Number(w[1]) : null };
  }
  if (!found) return { due: null, frozen };
  const d = found.d && found.d <= lastDay(year, found.m) ? found.d : lastDay(year, found.m);
  return { due: iso(year, found.m, d), frozen };
}
