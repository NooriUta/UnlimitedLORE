// Шапка не шире экрана в промежутке между телефоном и десктопом
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-EDGE, SPEC-SEIDRKIT-ADAPTIVE-TEST §3 п.1).
//
// Замер после выкатки v1.17.13 (11.11.2026, матрица спеки): планшет 768×1024 и
// телефон в ландшафте 915×412 — вся страница уезжает вбок (scrollWidth 849 и
// 948). Распирает шапку кнопка поиска «Поиск по LORE… (/)»: у неё жёсткий
// min-width 220 px вне телефонного порога, и при ширине 721…~850 шапка в
// экран не помещается. Таблица тут ни при чём — она прокручивается в своём блоке.
//
// Правило: в шапке ничто не держит жёсткую ширину — поиск сжимается до
// иконки, подпись обрезается многоточием. jsdom раскладку не считает, поэтому
// правило проверяется по CSS, с положительным контролем, что правила найдены.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Тела правил с данным селектором ВНЕ @media (база для всех ширин). */
function baseRules(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let head = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) head = css.slice(start, i).trim();
      if (depth === 0 && !head.startsWith('@')) {
        const end = css.indexOf('}', i);
        if (head.split(',').map(s => s.trim()).includes(sel)) out.push(css.slice(i + 1, end));
        i = end;
        start = end + 1;
        continue;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) start = i + 1;
    }
  }
  return out;
}

describe('шапка kit не шире экрана между телефоном и десктопом', () => {
  it('положительный контроль: базовые правила кнопки поиска найдены', () => {
    expect(baseRules('.sk-ptrig__search').length).toBeGreaterThan(0);
    expect(baseRules('.sk-ptrig').length).toBeGreaterThan(0);
  });

  it('кнопка поиска не держит жёсткую минимальную ширину', () => {
    for (const body of baseRules('.sk-ptrig__search')) {
      const m = /min-width:\s*(\d+)px/.exec(body);
      expect(m ? Number(m[1]) : 0, body).toBeLessThanOrEqual(44);
    }
  });

  it('кнопка поиска и её обёртка умеют сжиматься', () => {
    expect(baseRules('.sk-ptrig').join('\n')).toMatch(/min-width:\s*0/);
    expect(baseRules('.sk-ptrig__search').join('\n')).toMatch(/flex:\s*0 1 220px|flex-shrink:\s*1/);
  });

  it('подпись поиска обрезается многоточием, а не распирает шапку', () => {
    const body = baseRules('.sk-ptrig__text').join('\n');
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/text-overflow:\s*ellipsis/);
  });
});
