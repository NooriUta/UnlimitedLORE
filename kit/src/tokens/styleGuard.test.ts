// STYLE-01 для v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a): правила гварда
// вынесены в kit, чтобы kit и web-next проверялись ОДНИМ набором правил.
// Здесь — положительный контроль: правило, которое ничего не ловит, даёт
// зелёный гвард на любом коде.
import { describe, expect, it } from 'vitest';
import { STYLE_RULES, styleViolations } from './styleGuard';

describe('styleGuard · ловит заведомо плохие образцы', () => {
  const bad = {
    'x.tsx': "const s = { fontSize: 12, color: '#fff', background: 'rgba(0,0,0,.5)' };",
    'y.css': '.a { font-size: 11px; font: 600 13px/1 var(--font); color: #C85848; }',
  };

  it('каждое правило срабатывает', () => {
    expect(styleViolations(bad, STYLE_RULES.tsxFontSize)).toHaveLength(1);
    expect(styleViolations(bad, STYLE_RULES.hex)).toHaveLength(2);
    expect(styleViolations(bad, STYLE_RULES.rgb)).toHaveLength(1);
    expect(styleViolations(bad, STYLE_RULES.cssFontSize)).toHaveLength(1);
    expect(styleViolations(bad, STYLE_RULES.cssFontShorthand)).toHaveLength(1);
  });

  it('пропуск файла работает только для указанного', () => {
    expect(styleViolations(bad, STYLE_RULES.hex, p => p === 'y.css')).toEqual(["x.tsx: #fff"]);
  });

  it('комментарии не считаются нарушением', () => {
    const commented = { 'c.css': '/* было #fff и 12px */ .a { color: var(--t1); }', 'c.ts': '// fontSize: 12\nexport {};' };
    expect([
      ...styleViolations(commented, STYLE_RULES.hex),
      ...styleViolations(commented, STYLE_RULES.tsxFontSize),
    ]).toEqual([]);
  });
});

describe('styleGuard · не ловит правильные', () => {
  it('токены, var() и color-mix проходят', () => {
    const good = {
      'z.css': '.a { font-size: var(--fs-sm); font: 600 var(--fs-xs)/1 var(--font); color: var(--acc); background: color-mix(in srgb, var(--acc) 16%, var(--bg0)); }',
      'z.tsx': "const s = { fontSize: 'var(--fs-base)', color: 'var(--t2)' };",
    };
    const all = Object.values(STYLE_RULES).flatMap(re => styleViolations(good, re));
    expect(all).toEqual([]);
  });
});
