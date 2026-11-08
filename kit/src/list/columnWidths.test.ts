// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35 — ширины колонок.
//
// Эталон — прототип владелицы docs/prototypes/s4-35-columns.html:
//   • тянуть край заголовка; двойной щелчок — «по содержимому»;
//   • минимум 60 px, у «Записи» — от 220 px;
//   • ширины НЕ идут в адрес (их много, ссылка выходит нечитаемой);
//   • на телефоне (< 760 px) ширины не применяются, там карточки.
//
// Решение владелицы 08.11.2026: «ширина личная, набор командный». Поэтому
// ширины живут в личном хранилище, а не в сохранённом виде, и kit хранит их
// сам — в отличие от набора колонок, который он только отдаёт наружу.
import { describe, expect, it } from 'vitest';
import { MIN_COL_W, clampWidth, readWidths, widthsFor, writeWidths } from './columnWidths';

const mins = { 'title+id': 220 };

describe('S4-35 · ограничения ширины', () => {
  it('уже минимума не даём: колонка в 10 px нечитаема', () => {
    expect(clampWidth('status', 10, mins)).toBe(MIN_COL_W);
  });

  it('у «Записи» свой, больший минимум — там живёт название', () => {
    expect(clampWidth('title+id', 100, mins)).toBe(220);
    expect(clampWidth('title+id', 400, mins)).toBe(400);
  });

  it('разумную ширину не трогаем', () => {
    expect(clampWidth('status', 130, mins)).toBe(130);
  });

  it('мусор вместо числа — не ноль и не падение, а «ширина не задана»', () => {
    expect(clampWidth('status', Number.NaN, mins)).toBeUndefined();
    expect(clampWidth('status', -5, mins)).toBe(MIN_COL_W);
  });
});

describe('S4-35 · хранение ширин', () => {
  function mem() {
    const m = new Map<string, string>();
    return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => { m.set(k, v); }, map: m };
  }

  it('записываем и читаем по разделу: у каждого списка свои ширины', () => {
    const s = mem();
    writeWidths(s, 'sprints', { status: 130, 'title+id': 340 });
    expect(readWidths(s, 'sprints')).toEqual({ status: 130, 'title+id': 340 });
    expect(readWidths(s, 'adrs')).toEqual({});
  });

  it('битое хранилище — пустые ширины, а не падение списка', () => {
    const s = mem();
    s.set('kit.cols.w.sprints', '{не json');
    expect(readWidths(s, 'sprints')).toEqual({});
  });

  it('чужие значения в хранилище отсеиваются: ширина — это число', () => {
    const s = mem();
    s.set('kit.cols.w.sprints', JSON.stringify({ status: 130, bad: 'широко', worse: null }));
    expect(readWidths(s, 'sprints')).toEqual({ status: 130 });
  });

  it('ширины не попадают в адрес — это личная настройка', () => {
    const s = mem();
    writeWidths(s, 'sprints', { status: 130 });
    // Ключ хранилища, а не параметр строки запроса.
    expect([...s.map.keys()]).toEqual(['kit.cols.w.sprints']);
  });
});

describe('S4-35 · применение ширин', () => {
  it('на узком экране ширины не применяются: там карточки', () => {
    expect(widthsFor({ status: 130 }, mins, true)).toEqual({});
  });

  it('на широком применяются с поправкой на минимумы', () => {
    expect(widthsFor({ status: 10, 'title+id': 100 }, mins, false))
      .toEqual({ status: MIN_COL_W, 'title+id': 220 });
  });

  it('колонка без сохранённой ширины остаётся без ширины — таблица решает сама', () => {
    expect(widthsFor({ status: 130 }, mins, false)).toEqual({ status: 130 });
  });
});
