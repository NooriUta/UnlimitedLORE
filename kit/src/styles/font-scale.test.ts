// STYLE-01 для Seiðr-kit (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a). Гвард v1
// (src/styles/font-scale.test.ts) смотрит только корневой src/ — kit он не
// видит. Здесь правило строже: унаследованных исключений нет, поэтому запрещено
// ЛЮБОЕ число в fontSize/font-size и любой сырой цвет вне seidr.css — шкала и
// палитра остаются единственной точкой правки.
import { describe, expect, it } from 'vitest';
import { STYLE_RULES, styleViolations } from '../tokens/styleGuard';

const code = import.meta.glob(['../**/*.tsx', '../**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const css = import.meta.glob('../**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/**
 * Единственный файл, где число и hex — это определение токена, а не его копия.
 * Ключи glob относительны этого файла: seidr.css лежит рядом и приходит как './seidr.css'.
 */
const TOKENS = /(?:^|\/)seidr\.css$/;
const isTokens = (p: string) => TOKENS.test(p);

describe('STYLE-01 (kit) · гвард не слепой', () => {
  it('видит исходники kit и seidr.css', () => {
    expect(Object.keys(code).some(p => p.endsWith('/tokens/prefs.ts'))).toBe(true);
    expect(Object.keys(css).some(isTokens)).toBe(true);
  });
});

describe('STYLE-01 (kit) · размеры шрифта только токенами', () => {
  it('в TS/TSX нет fontSize числом', () => {
    expect(styleViolations(code, STYLE_RULES.tsxFontSize), 'используйте var(--fs-*)').toEqual([]);
  });

  it('в CSS нет font-size/font: числом вне seidr.css', () => {
    expect(styleViolations(css, STYLE_RULES.cssFontSize, isTokens)).toEqual([]);
    expect(styleViolations(css, STYLE_RULES.cssFontShorthand, isTokens)).toEqual([]);
  });

  it('и в seidr.css font-size в правилах — тоже токеном (число только в объявлении --fs-*)', () => {
    const own = Object.fromEntries(Object.entries(css).filter(([p]) => isTokens(p)));
    expect(styleViolations(own, STYLE_RULES.cssFontSize)).toEqual([]);
    expect(styleViolations(own, STYLE_RULES.cssFontShorthand)).toEqual([]);
  });
});

describe('STYLE-01 (kit) · цвета только токенами', () => {
  it('нет сырых hex/rgb/hsl в TS/TSX', () => {
    expect(styleViolations(code, STYLE_RULES.hex), 'используйте var(--bg*/--t*/--acc/…)').toEqual([]);
    expect(styleViolations(code, STYLE_RULES.rgb), 'используйте var(--…) или color-mix').toEqual([]);
  });

  it('нет сырых hex/rgb/hsl в CSS вне seidr.css', () => {
    expect(styleViolations(css, STYLE_RULES.hex, isTokens)).toEqual([]);
    expect(styleViolations(css, STYLE_RULES.rgb, isTokens)).toEqual([]);
  });
});
