// S4-00b / S4-00e: стиль элементов живёт в едином CSS-слое (seidr.css), чтобы
// тот же вид получал и голый HTML. jsdom раскладку не считает, поэтому
// требования «≥44px на касании», «pill 999» и «видимый фокус» проверяются по
// правилам в файле — и с положительным контролем, что правило найдено.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Чтение с диска, а не `?raw`: vitest отдаёт CSS-модули пустой строкой (css: false).
const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8');

it('положительный контроль: seidr.css прочитан', () => {
  expect(css).toMatch(/--fs-base/);
});

/** Тело первого правила с данным селектором (точное совпадение начала блока). */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}


/** Тела всех блоков @media с данным условием — со счётом скобок, без захода в соседние блоки. */
function mediaBodies(cond: string): string[] {
  // Комментарии вырезаются: скобка в тексте комментария сбила бы счёт.
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  const head = '@media ' + cond;
  let i = src.indexOf(head);
  while (i >= 0) {
    const open = src.indexOf('{', i);
    let depth = 1, j = open + 1;
    while (depth && j < src.length) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
    out.push(src.slice(open + 1, j - 1));
    i = src.indexOf(head, j);
  }
  return out;
}
const coarse = () => mediaBodies('(pointer: coarse) {').join('\n');
const narrow = () => mediaBodies('(max-width: 720px), (pointer: coarse) and (max-height: 500px) {').join('\n');

describe('seidr.css · стиль базовых элементов', () => {
  it('pill — скругление токеном 999', () => {
    expect(rule('.sk-pill')).toMatch(/border-radius:\s*var\(--r-pill\)/);
  });

  it('IconButton — цель не меньше --tap (44px на касании) и видимый фокус', () => {
    const body = rule('.sk-iconbtn');
    expect(body).toMatch(/min-width:\s*max\(var\(--tap\)/);
    expect(body).toMatch(/min-height:\s*max\(var\(--tap\)/);
    expect(rule('.sk-iconbtn:focus-visible')).toMatch(/outline:\s*2px solid var\(--acc\)/);
  });

  // D-2026-UXR-MOBILE-FOLLOWS-V1 (11.11.2026): видимый размер ≠ зона касания.
  // Раньше на сенсоре --tap = 44px раздувал САМ элемент: чип с подписью 10 px
  // становился овалом 44 px, и управление съедало 61% экрана телефона до первой
  // строки (689 px против 245 в v1). Теперь элемент остаётся плотным, как в v1,
  // а 44 px дорисовывает невидимая зона ::after — приём Material (чип 32, цель 48).
  describe('цель касания на сенсоре — невидимой зоной, а не ростом элемента', () => {
    it('--tap на сенсоре элемент НЕ раздувает (остаётся 0)', () => {
      expect(css).not.toMatch(/\{\s*:root\s*\{\s*--tap:\s*44px/);
    });

    it('--hit = 44px задаётся видом указателя, а не шириной окна', () => {
      expect(coarse()).toMatch(/:root\s*\{\s*--hit:\s*44px/);
      expect(mediaBodies('(pointer: coarse), (max-width: 768px) {').join('\n')).not.toMatch(/--hit/);
    });

    it('зона касания: ::after по центру, не меньше --hit и не меньше самого элемента', () => {
      const m = /([^{}]*)::after\s*\{([^}]*)\}/.exec(coarse());
      expect(m, 'правило зоны касания найдено').not.toBeNull();
      const body = m![2];
      expect(body).toMatch(/content:\s*''/);
      expect(body).toMatch(/position:\s*absolute/);
      expect(body).toMatch(/width:\s*max\(100%,\s*var\(--hit\)\)/);
      expect(body).toMatch(/height:\s*max\(100%,\s*var\(--hit\)\)/);
      expect(body).toMatch(/translate\(-50%,\s*-50%\)/);
    });

    it('ссылки в тексте зону не получают — только элементы kit (иначе соседние строки прозы ловят касание)', () => {
      const m = /([^{}]*)::after\s*\{/.exec(coarse());
      expect(m, 'правило зоны касания найдено').not.toBeNull();
      expect(m![0]).toMatch(/a\[href\]\[class\*='sk-'\]/);
      expect(m![0]).not.toMatch(/(^|[\s,(])a\[href\](?!\[)/);
    });

    it('поле ввода на сенсоре — высотой --hit (у поля нет ::after)', () => {
      expect(coarse()).toMatch(/input[^{}]*\{[^}]*min-height:\s*var\(--hit\)/);
    });
  });

  // Владелица 11.11: «проверяй чтобы не было желательно горизонтальных скроллов» —
  // поэтому не прокрутка вбок, а перенос в прямоугольный блок.
  it('переключатель видов на узком экране не становится овалом и не прокручивается вбок', () => {
    const m = /\.sk-list__views\s*\{([^}]*)\}/.exec(narrow());
    expect(m, 'правило найдено').not.toBeNull();
    expect(m![1]).toMatch(/border-radius:\s*var\(--r-md\)/);
    expect(m![1]).not.toMatch(/overflow-x/);
    expect(m![1]).not.toMatch(/nowrap/);
  });

  it('звезда статуса и фильтр-пилюля тоже ≥ --tap', () => {
    expect(rule('.sk-star--btn')).toMatch(/min-height:\s*max\(var\(--tap\)/);
    expect(rule('.sk-pill--filter')).toMatch(/min-height:\s*max\(var\(--tap\)/);
  });

  it('подсказка клавиш прячется на сенсоре (клавиатуры там нет)', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{[^}]*\.sk-kbd\s*\{\s*display:\s*none/);
  });
});
