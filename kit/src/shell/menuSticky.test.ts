// Аудит навигации 08.11.2026, находка P1: «Левое меню не залипает:
// position: static, высота 2467 px при окне 1000 — при прокрутке списка меню
// уезжает вместе со страницей… до "Настройки" не добраться, не прокрутив всю
// страницу». Её же предложение оттуда: «position: sticky; top: 44px и свой
// скролл».
//
// Почему именно так, а не «страница на высоту окна»: у записи длинное тело, и
// привычная прокрутка страницы остаётся правильной. Липнет меню, а не меняется
// способ прокрутки всего приложения.
//
// Две тонкости, без которых правило не работает и выглядит «сделанным»:
//   • шапка тоже должна липнуть, иначе top: 44px оставляет меню под уехавшей
//     шапкой — зазор в 44 px ниоткуда;
//   • элемент сетки по умолчанию растянут на всю строку (align-self: stretch),
//     и sticky у растянутого элемента никогда не срабатывает: нужен
//     align-self: start.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const ruleOf = (sel: string) => {
  const start = css.indexOf(`\n${sel} {`);
  if (start < 0) return '';
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};

describe('левое меню залипает', () => {
  it('положительный контроль: правила шапки и колонки меню найдены', () => {
    expect(ruleOf('.sk-shell__top')).not.toBe('');
    expect(ruleOf('.sk-shell__side')).not.toBe('');
  });

  it('шапка липнет к верху и лежит выше содержимого', () => {
    const top = ruleOf('.sk-shell__top');
    expect(top).toMatch(/position:\s*sticky/);
    expect(top).toMatch(/top:\s*0/);
    expect(top).toMatch(/z-index:\s*\d+/);
  });

  it('меню липнет под шапкой, а не под её прежним местом', () => {
    const side = ruleOf('.sk-shell__side');
    expect(side).toMatch(/position:\s*sticky/);
    // Высота шапки — var(--sk-top-h), чтобы два числа не разъехались.
    expect(side).toMatch(/top:\s*var\(--sk-top-h/);
    expect(ruleOf('.sk-shell__top')).toMatch(/min-height:\s*var\(--sk-top-h/);
  });

  it('у меню своя прокрутка в пределах экрана — иначе «Настройки» недостижимы', () => {
    const side = ruleOf('.sk-shell__side');
    expect(side).toMatch(/overflow:\s*auto/);
    expect(side).toMatch(/max-height:\s*calc\(100dvh - var\(--sk-top-h/);
  });

  it('колонка не растянута: у растянутого элемента сетки sticky не работает', () => {
    expect(ruleOf('.sk-shell__side')).toMatch(/align-self:\s*start/);
  });

  it('шапка остаётся ниже накладок: док во весь экран и палитра перекрывают её', () => {
    const z = (sel: string) => Number(/z-index:\s*(\d+)/.exec(ruleOf(sel))?.[1] ?? 'NaN');
    expect(z('.sk-shell__top')).toBeLessThan(z(".sk-dock[data-placement='full']"));
  });
});

// Владелица 11.11.2026 (S4-21): «при большом разрешении левое меню повисает в
// воздухе внизу, а не продолжается на всю длину». Причина: у колонки меню была
// только max-height, без высоты, — при align-self: start её фон и правая граница
// кончались там, где кончались пункты, и на высоком окне меню обрывалось
// посреди экрана. Колонка обязана занимать всю высоту окна под шапкой.
describe('левое меню — на всю высоту окна', () => {
  it('высота колонки меню = окно минус шапка, а не «по пунктам»', () => {
    expect(ruleOf('.sk-shell__side')).toMatch(/(^|[;\s])height:\s*calc\(100dvh - var\(--sk-top-h\)\)/);
  });
});
