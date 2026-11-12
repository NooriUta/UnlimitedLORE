// «Цель к сроку» (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-TARGET): прогноз и вердикт считает
// приложение — kit только рисует (K-14). Владелица 12.11.2026: «да» на старт.
//
// Скорость — сколько закрыто за последние WINDOW дней истории (короче история — за всю).
// Прогноз — день, когда при этой скорости закроется остаток. Вердикт словами:
//   «Успеваем, закончим DD.MM» · «Не успеваем на N дн.: нужно X в неделю или убрать Y».
// Тон: опоздание до недели — risk, больше — late (допущение, названо владелице).
// Нет истории или срока — null: вердикт без данных не выдумывается.
import type { BurnForecastPoint, BurnPoint, BurnVerdict, KitLang } from '@seidr/kit';

const WINDOW = 14;
const RISK_DAYS = 7;
const DAY = 86_400_000;

const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

export interface TargetForecast {
  forecast: BurnForecastPoint[];
  verdict: BurnVerdict;
  /** День окончания по прогнозу; null — скорости нет. */
  finish: string | null;
  /** Насколько позже срока (0 — успеваем). */
  lateDays: number;
}

const TEXT = {
  ru: {
    done: 'Готово',
    ok: (d: string) => `Успеваем, закончим ${d.slice(8, 10)}.${d.slice(5, 7)}`,
    late: (n: number, perWeek: string, drop: number) => `Не успеваем на ${n} дн.: нужно ${perWeek} в неделю или убрать ${drop}`,
    still: (n: number) => `За ${n} дн. ничего не закрыто — скорости нет, прогноз не построить`,
    num: (v: number) => v.toFixed(1).replace('.', ','),
  },
  en: {
    done: 'Done',
    ok: (d: string) => `On track, finishing ${d}`,
    late: (n: number, perWeek: string, drop: number) => `${n} days late: need ${perWeek} a week or drop ${drop}`,
    still: (n: number) => `Nothing closed in ${n} days — no velocity, no forecast`,
    num: (v: number) => v.toFixed(1),
  },
} as const;

export function targetForecast(points: readonly BurnPoint[], deadline: string | null | undefined, today: string, lang: KitLang): TargetForecast | null {
  if (!points.length || !deadline) return null;
  const t = TEXT[lang === 'en' ? 'en' : 'ru'];
  const last = points[points.length - 1];
  if (last.remaining <= 0) return { forecast: [], verdict: { tone: 'ok', text: t.done }, finish: last.date, lateDays: 0 };

  // Скорость: закрыто от начала окна до последней точки; окно — не длиннее истории.
  const from = iso(ms(today) - WINDOW * DAY);
  const base = [...points].reverse().find(p => p.date <= from) ?? points[0];
  const span = Math.max(1, days(base.date, today));
  const perDay = (last.done - base.done) / span;
  if (perDay <= 0) {
    return { forecast: [], verdict: { tone: 'late', text: t.still(span) }, finish: null, lateDays: 0 };
  }

  const finish = iso(ms(today) + Math.ceil(last.remaining / perDay) * DAY);
  const lateDays = Math.max(0, days(deadline, finish));
  const forecast = [{ date: finish, done: last.scope }];
  if (lateDays === 0) return { forecast, verdict: { tone: 'ok', text: t.ok(finish) }, finish, lateDays };

  const left = Math.max(1, days(today, deadline));
  const perWeek = (last.remaining / left) * 7;
  const byDeadline = Math.floor(last.done + perDay * Math.max(0, days(today, deadline)));
  const drop = Math.max(1, last.scope - byDeadline);
  return {
    forecast,
    verdict: { tone: lateDays <= RISK_DAYS ? 'risk' : 'late', text: t.late(lateDays, t.num(perWeek), drop) },
    finish,
    lateDays,
  };
}
