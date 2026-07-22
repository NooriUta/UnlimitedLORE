import { describe, expect, it } from 'vitest';
import { pageBounds, coverageOf, PAGE } from './LoreSearchScreen';

// SRCH-09: пагинация и баннер покрытия сквозного поиска (ADR-LORE-033).
//
// Проверяется арифметика, а не разметка: обе ошибки этого экрана незаметны
// глазом. «Показаны 51–100 из 80» выглядит правдоподобно, и счётчик покрытия,
// слитый из двух разных величин, тоже читается как исправный.

describe('pageBounds', () => {
  it('первая страница считается от единицы, а не от нуля', () => {
    expect(pageBounds(300, 0)).toEqual({ from: 1, to: PAGE, hasPrev: false, hasNext: true });
  });

  it('вторая страница сдвигает окно и открывает шаг назад', () => {
    const b = pageBounds(300, PAGE);
    expect(b.from).toBe(PAGE + 1);
    expect(b.to).toBe(PAGE * 2);
    expect(b.hasPrev).toBe(true);
    expect(b.hasNext).toBe(true);
  });

  /**
   * Последняя страница короче полной, и «до» обязано упираться в total.
   * Без ограничения UI обещал бы записи, которых нет, — а проверить это на
   * глаз нельзя: число выглядит нормальным.
   */
  it('последняя страница не обещает больше, чем найдено', () => {
    const b = pageBounds(80, PAGE);
    expect(b.to).toBe(80);
    expect(b.hasNext).toBe(false);
    expect(b.hasPrev).toBe(true);
  });

  it('выдача ровно в страницу не предлагает следующую', () => {
    expect(pageBounds(PAGE, 0).hasNext).toBe(false);
  });

  /** Пустая выдача — «0», а не «1–0»: диапазон из ничего не бывает. */
  it('на пустой выдаче диапазон не рисуется', () => {
    expect(pageBounds(0, 0)).toEqual({ from: 0, to: 0, hasPrev: false, hasNext: false });
  });
});

describe('coverageOf', () => {
  const hit = (components: string[], inherited_from: string | null = null) =>
    ({ components, inherited_from });

  /**
   * Ключевое различие баннера: выведенная привязка ЕСТЬ (получена от родителя),
   * а у голого хита её нет вовсе. Слить их в один счётчик значило бы обещать
   * связь там, где её не существует, — и «фильтр по компоненту скроет N» стало
   * бы неверным ровно для тех записей, ради которых предупреждение и пишется.
   */
  it('выведенная привязка не считается отсутствующей', () => {
    const c = coverageOf([
      hit(['OMILORE'], 'SPRINT_X'),
      hit(['FORSETI']),
      hit([]),
    ]);
    expect(c.inherited).toBe(1);
    expect(c.bare).toBe(1);
  });

  it('хит без компонентов считается голым независимо от происхождения', () => {
    expect(coverageOf([hit([]), hit([])]).bare).toBe(2);
  });

  it('полностью привязанная выдача не тревожит предупреждением', () => {
    const c = coverageOf([hit(['A']), hit(['B'])]);
    expect(c.bare).toBe(0);
    expect(c.inherited).toBe(0);
  });

  it('пустая выдача не даёт ложных нулей-с-предупреждением', () => {
    expect(coverageOf([])).toEqual({ inherited: 0, bare: 0 });
  });
});
