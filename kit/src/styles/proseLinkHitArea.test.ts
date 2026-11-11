// Ссылка внутри текста НЕ ловит касания соседних строк (находка мобильной сессии 11.11.2026
// по прототипу Peek, SPRINT_UXR_S10_SEIDR_KIT_2/MD-READ-PEEK).
//
// На сенсоре (pointer: coarse) элементам kit даётся невидимая зона касания 44 px через ::after
// (#1179, S4-MOBILE-COMPARE). Ссылкам — только с kit-классом: `a[href][class*='sk-']`, чтобы
// ссылка в прозе не перехватывала касания соседних строк. Но ссылка [[…]] в чтении (#1180) —
// это `a.sk-wref`, то есть kit-класс внутри прозы: она попадала под зону и в абзаце на телефоне
// забирала нажатия у строк выше и ниже.
//
// Правило общее, не частный случай одной рамки: у ЛЮБОЙ ссылки внутри `.sk-prose` на сенсоре
// зоны нет — строка текста сама и есть цель касания.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src/styles/seidr.css'), 'utf8');

/** Тела всех блоков @media (pointer: coarse) подряд. */
function coarseBlocks(): string {
  const out: string[] = [];
  let at = css.indexOf('@media (pointer: coarse)');
  while (at >= 0) {
    let i = css.indexOf('{', at) + 1;
    let depth = 1;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
    at = css.indexOf('@media (pointer: coarse)', i);
  }
  return out.join('\n');
}

describe('ссылка в прозе без зоны касания 44 px', () => {
  it('рамка [[…]] в чтении — kit-класс, поэтому без исключения попала бы под зону', () => {
    // положительный контроль: правило зоны действительно цепляет a.sk-wref
    expect(css).toContain("a[href][class*='sk-']");
    expect(css).toMatch(/a\.sk-wref\s*\{/);
  });
  it('на сенсоре у ссылок внутри .sk-prose ::after снят', () => {
    const block = coarseBlocks();
    const m = /([^{}]*\.sk-prose\s+a\[href\][^{}]*::after)\s*\{([^}]*)\}/.exec(block);
    expect(m, 'в @media (pointer: coarse) нет правила для .sk-prose a[href]::after').not.toBeNull();
    expect(m![2]).toMatch(/content:\s*none/);
  });
});
