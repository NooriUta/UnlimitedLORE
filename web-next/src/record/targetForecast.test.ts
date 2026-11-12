// SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-TARGET — прогноз и вердикт «Цели к сроку» считает
// ПРИЛОЖЕНИЕ (K-14): kit рисует готовые точки и слова. Скорость — закрытое за последние
// 14 дней истории; прогноз — когда при этой скорости закроется остаток; вердикт —
// «успеваем» / «не успеваем на N дней: нужно X в неделю или убрать Y».
import { describe, expect, it } from 'vitest';
import { targetForecast } from './targetForecast';

const pt = (date: string, scope: number, done: number) => ({ date, scope, done, remaining: scope - done });

describe('K2-VIEW-TARGET · прогноз и вердикт приложения', () => {
  // 14 дней: закрыто 7 → скорость 0,5 в день (3,5 в неделю). Остаток 10.
  const POINTS = [pt('2026-10-29', 20, 3), pt('2026-11-12', 20, 10)];

  it('успеваем: остаток закрывается до срока — тон ok, прогноз до даты окончания', () => {
    const r = targetForecast(POINTS, '2026-12-31', '2026-11-12', 'ru')!;
    expect(r.finish).toBe('2026-12-02');
    expect(r.verdict.tone).toBe('ok');
    expect(r.verdict.text).toMatch(/Успеваем/);
    expect(r.forecast[r.forecast.length - 1]).toEqual({ date: '2026-12-02', done: 20 });
  });

  it('не успеваем на N дней — сказано, сколько нужно в неделю и сколько убрать', () => {
    // срок 25.11: 13 дней × 0,5 = 6,5 → закроется 16 из 20; опоздание 7 дней.
    const r = targetForecast(POINTS, '2026-11-25', '2026-11-12', 'ru')!;
    expect(r.lateDays).toBe(7);
    expect(r.verdict.tone).toBe('risk');
    expect(r.verdict.text).toBe('Не успеваем на 7 дн.: нужно 5,4 в неделю или убрать 4');
  });

  it('опоздание больше недели — тон late', () => {
    expect(targetForecast(POINTS, '2026-11-15', '2026-11-12', 'ru')!.verdict.tone).toBe('late');
  });

  it('всё закрыто — «готово», прогноза нет', () => {
    const r = targetForecast([pt('2026-11-01', 5, 0), pt('2026-11-10', 5, 5)], '2026-11-30', '2026-11-12', 'ru')!;
    expect(r.verdict).toEqual({ tone: 'ok', text: 'Готово' });
    expect(r.forecast).toEqual([]);
  });

  it('за 14 дней не закрыто ничего — скорости нет, прогноз не выдумываем, сказано словами', () => {
    const r = targetForecast([pt('2026-11-01', 5, 1), pt('2026-11-12', 5, 1)], '2026-11-30', '2026-11-12', 'ru')!;
    expect(r.forecast).toEqual([]);
    expect(r.verdict.tone).toBe('late');
    expect(r.verdict.text).toMatch(/скорости нет/);
  });

  it('истории нет или срока нет — null: вердикт без данных не выдумывается', () => {
    expect(targetForecast([], '2026-11-30', '2026-11-12', 'ru')).toBeNull();
    expect(targetForecast(POINTS, null, '2026-11-12', 'ru')).toBeNull();
  });
});
