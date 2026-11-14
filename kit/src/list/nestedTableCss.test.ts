// Владелица 14.11.2026 (скрин вложенной таблицы задач спринта): «либо size под длину, либо если
// не помещается — scroll» и «слишком высокие строки». Вложенная таблица не распирает внешнюю
// (колонка «Изменено» уходила за правый край): её контейнер берёт ширину ячейки и прокручивается
// по горизонтали; строки — компактные, а не roomy-высоты верхнего уровня.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const rule = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  expect(i, `правила ${sel} нет`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};

describe('вложенная таблица: ширина и высота строк', () => {
  it('контейнер не распирает внешнюю таблицу и прокручивается по горизонтали', () => {
    const r = rule('.sk-list__nested');
    expect(r).toMatch(/width:\s*0/);
    expect(r).toMatch(/min-width:\s*100%/);
    expect(r).toMatch(/overflow-x:\s*auto/);
  });
  it('строки вложенной таблицы компактные: своя высота строки и одна строка названия', () => {
    const r = rule('.sk-list__nested .sk-list--bare');
    expect(r).toMatch(/--list-row-h:\s*max\(var\(--tap\),\s*28px\)/);
    expect(r).toMatch(/--list-title-lines:\s*1/);
  });
});
