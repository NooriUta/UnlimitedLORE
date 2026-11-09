// @vitest-environment jsdom
// Сумма с охватом: ноль и «не заполнено» — разные утверждения
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09).
//
// Повод — просьба владелицы 09.11.2026: «оценка и размер спринтов суммарно по
// дням и задач тоже важный элемент а его нет». Простая числовая колонка её не
// закрывает, и это ЗАМЕР, а не осторожность: в корпусе LORE поле «факт»
// (`actual_days`) не заполнено НИ У ОДНОЙ задачи — 0 из 1372 по двадцати
// крупнейшим спринтам, при оценке, заполненной у 70%. Число в такой колонке
// было бы нулём, и он прочитался бы как «сделали за 0 дней».
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SumCell, colKey, formatSum, sumOf } from './sum';

describe('sumOf: разбор значения', () => {
  it('положительный контроль: полная сумма', () => {
    expect(sumOf({ value: 12.5, known: 14, of: 14 })).toMatchObject({ kind: 'full', value: 12.5 });
  });

  it('часть заполнена — отдельный исход, а не «полная сумма»', () => {
    expect(sumOf({ value: 9, known: 9, of: 14 })).toMatchObject({ kind: 'partial', value: 9, known: 9, of: 14 });
  });

  it('охват ноль — «не заполнено», и значение не смотрим вовсе', () => {
    // Даже если приложение прислало 0: утверждать «итог ноль» не из чего.
    expect(sumOf({ value: 0, known: 0, of: 14 })).toEqual({ kind: 'empty', of: 14 });
    expect(sumOf({ value: null, known: 0, of: 14 })).toEqual({ kind: 'empty', of: 14 });
  });

  it('ошибка и загрузка — свои исходы, не 0 и не «нет данных»', () => {
    expect(sumOf({ error: 'пачка не ответила' })).toEqual({ kind: 'error', reason: 'пачка не ответила' });
    expect(sumOf({ loading: true })).toEqual({ kind: 'loading' });
  });

  it('мусор и отсутствие — «не посчитано»', () => {
    expect(sumOf(undefined)).toEqual({ kind: 'none' });
    expect(sumOf(12.5)).toEqual({ kind: 'none' });
    expect(sumOf({ value: 1 })).toEqual({ kind: 'none' });
    // Охват обязан быть целым и неотрицательным: «известно у -1» бессмысленно.
    expect(sumOf({ value: 1, known: -1, of: 3 })).toEqual({ kind: 'none' });
    expect(sumOf({ value: 1, known: 1.5, of: 3 })).toEqual({ kind: 'none' });
  });

  it('значение не число при непустом охвате — «не посчитано», а не ноль', () => {
    expect(sumOf({ value: null, known: 3, of: 5 })).toEqual({ kind: 'none' });
  });
});

describe('formatSum: лишних нулей нет, разделитель по языку', () => {
  it.each([
    [12, 'ru', '12'],
    [12.5, 'ru', '12,5'],
    [12.5, 'en', '12.5'],
    [1234.25, 'en', '1,234.25'],
  ])('%s (%s) → %s', (v, lang, out) => {
    expect(formatSum(v as number, lang as string)).toBe(out);
  });
});

describe('colKey: имя поля из ключа колонки', () => {
  it.each([
    ['sum:effort', 'effort'],
    ['progress:tasks', 'tasks'],
    ['status', 'status'],
  ])('%s → %s', (col, key) => {
    expect(colKey(col)).toBe(key);
  });
});

describe('SumCell: что видит человек', () => {
  it('полная сумма — просто число с единицей', () => {
    render(<SumCell value={{ value: 12.5, known: 14, of: 14, unit: 'д' }} />);
    expect(screen.getByText(/12,5/)).toBeTruthy();
    // Охвата в строке нет: он полный, и оговорка была бы шумом.
    expect(document.body.textContent).not.toMatch(/из 14/);
  });

  it('частичная — число И охват ВИДНЫ В СТРОКЕ, а не только в подсказке', () => {
    // На телефоне наведения нет, поэтому спрятанная в title оговорка там не
    // существует. Это та же причина, по которой «ещё N» рисуется текстом.
    render(<SumCell value={{ value: 9, known: 9, of: 14, unit: 'д' }} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/9/);
    expect(text).toMatch(/9 из 14/);
  });

  it('не заполнено ни у кого — СЛОВА, а не ноль', () => {
    render(<SumCell value={{ value: null, known: 0, of: 14 }} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/не заполнено/i);
    expect(text).not.toMatch(/\b0\b/);
  });

  it('ошибка не выдаёт себя за ноль: «?» и причина в подсказке', () => {
    render(<SumCell value={{ error: 'срез не ответил' }} />);
    const el = screen.getByText('?');
    expect(el.getAttribute('title')).toMatch(/срез не ответил/);
  });

  it('пока считаем — «…», и это не «нет данных»', () => {
    render(<SumCell value={{ loading: true }} />);
    expect(screen.getByText('…')).toBeTruthy();
  });

  /**
   * «Складывали не всё» — отдельное утверждение, а не вид охвата.
   *
   * Повод настоящий и найден по коду сервера: признак обрезки в ответе среза
   * относится к СТРОКАМ-СЛАГАЕМЫМ (тело ответа собирается до свёртки), то есть
   * обрезка занижает сумму. Без этого признака число выглядело бы точным —
   * худший исход: охват «14 из 14» при половине невиданных слагаемых.
   */
  it('обрезанная выдача: звёздочка в строке и причина в подсказке', () => {
    render(<SumCell value={{ value: 12.5, known: 14, of: 14, cut: true }} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/12,5\*/);
    expect(document.querySelector('[data-cut="true"]')).toBeTruthy();
    expect(document.querySelector('.sk-sum')?.getAttribute('title')).toMatch(/обрезали/i);
  });

  it('обрезка не подменяет охват: оба признака живут вместе', () => {
    render(<SumCell value={{ value: 9, known: 9, of: 14, cut: true }} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/9 из 14/);
    expect(text).toMatch(/\*/);
  });

  it('обрезка при пустом охвате: «не заполнено» тоже под сомнением', () => {
    // Даже «ни у кого не заполнено» недоказуемо, если часть строк не видели.
    render(<SumCell value={{ value: null, known: 0, of: 14, cut: true }} />);
    expect(document.querySelector('[data-sum="empty"][data-cut="true"]')).toBeTruthy();
  });

  it('без обрезки признака НЕТ — иначе звёздочка стала бы украшением', () => {
    render(<SumCell value={{ value: 1, known: 1, of: 1 }} />);
    expect(document.querySelector('[data-cut]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\*/);
  });

  it('у каждого исхода свой признак в разметке — по нему и стиль, и тест', () => {
    const { container, unmount } = render(<SumCell value={{ value: 1, known: 1, of: 2 }} />);
    expect(container.querySelector('[data-sum="partial"]')).toBeTruthy();
    unmount();
    const { container: c2 } = render(<SumCell value={{ value: null, known: 0, of: 2 }} />);
    expect(c2.querySelector('[data-sum="empty"]')).toBeTruthy();
  });
});
