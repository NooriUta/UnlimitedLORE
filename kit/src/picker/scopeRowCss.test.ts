// SPRINT_UXR_POLISH_UAT_1113/PU-06 — строка выбора проектов в шапке.
// Приёмка 13.11 (окно 1568): у AIDA/Datawanderers-ServerandLore пилюля «мой»
// наезжала на «только этот», а человеческие имена обрезались до «Студи…».
// Причина: slug (.sk-scope__id) не сжимался (nowrap без overflow), выталкивал
// пилюлю за пределы подписи, а сжималось имя. Правило: сжимается slug и
// сжимается первым; имя читается; пилюля и «только этот» не сжимаются и не
// накладываются (подпись обрезает вылезающее). jsdom раскладку не считает —
// проверяются правила, с положительным контролем.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel: string): string => {
  const m = new RegExp(`(?:^|\n)${sel.replace(/[.]/g, '\.')} \{([^}]*)\}`).exec(css);
  return m ? m[1] : '';
};
const shrink = (body: string): number => {
  const m = /flex-shrink:\s*(\d+)/.exec(body) ?? /flex:\s*\d+\s+(\d+)/.exec(body);
  return m ? Number(m[1]) : 1;
};

describe('PU-06 — строка проекта: имя | slug | мой | только этот без наложения', () => {
  it('положительный контроль: правила строки на месте', () => {
    expect(rule('.sk-scope__check')).toMatch(/display: flex/);
    expect(rule('.sk-scope__title')).toMatch(/text-overflow: ellipsis/);
  });

  it('slug сжимается с многоточием и раньше имени', () => {
    const id = rule('.sk-scope__id');
    expect(id).toMatch(/min-width: 0/);
    expect(id).toMatch(/overflow: hidden/);
    expect(id).toMatch(/text-overflow: ellipsis/);
    expect(shrink(id)).toBeGreaterThan(shrink(rule('.sk-scope__title')));
  });

  // Приёмка на проде v1.17.20: при правиле v1.17.18 (имя flex-shrink 0 + max-width 100%)
  // длинное «Студия — …» занимало ВСЮ подпись: slug и «мой» уходили за край, а имя
  // с многоточием упиралось в «только этот». Правило: имя сжимается (min-width 0,
  // многоточие), но slug не отнимает у него место — slug с базой 0 берёт только
  // свободное (flex: 1 1 0), поэтому короткие имена не срезаются (замечание v1.17.18).
  it('длинное имя сжимается с многоточием и не занимает место пилюль', () => {
    const title = rule('.sk-scope__title');
    expect(shrink(title)).toBeGreaterThan(0);
    expect(title).toMatch(/min-width: 0/);
    expect(title).not.toMatch(/max-width: 100%/);
  });

  it('slug берёт только свободное место: база 0 — короткое имя он не срезает', () => {
    expect(rule('.sk-scope__id')).toMatch(/flex: 1 \d+ 0/);
  });

  it('«только этот» не переносится и не сжимается', () => {
    expect(rule('.sk-scope__only')).toMatch(/white-space: nowrap/);
  });

  it('пилюля «мой» не сжимается, подпись не выпускает содержимое на «только этот»', () => {
    expect(shrink(rule('.sk-scope__tag'))).toBe(0);
    expect(shrink(rule('.sk-scope__only'))).toBe(0);
    expect(rule('.sk-scope__check')).toMatch(/overflow: hidden/);
  });
});
