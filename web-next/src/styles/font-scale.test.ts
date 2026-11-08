// STYLE-01 для web-next (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a). Гвард v1
// (src/styles/font-scale.test.ts) смотрит только корневой src/, и v2 мог бы с
// первого же экрана снова писать размеры и цвета числом. Правила — те же, что
// у kit (@seidr/kit/style-guard), а исключений здесь нет вовсе: токены
// объявляет kit (seidr.css), web-next их только использует.
import { describe, expect, it } from 'vitest';
import { STYLE_RULES, styleViolations } from '@seidr/kit/style-guard';

const code = import.meta.glob(['../**/*.tsx', '../**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const css = import.meta.glob('../**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('STYLE-01 (web-next) · гвард не слепой', () => {
  it('видит исходники web-next', () => {
    expect(Object.keys(code).some(p => p.endsWith('/App.tsx'))).toBe(true);
  });
});

describe('STYLE-01 (web-next) · только токены', () => {
  it('нет fontSize числом в TS/TSX', () => {
    expect(styleViolations(code, STYLE_RULES.tsxFontSize), 'используйте var(--fs-*)').toEqual([]);
  });

  it('нет font-size/font: числом в CSS', () => {
    expect(styleViolations(css, STYLE_RULES.cssFontSize)).toEqual([]);
    expect(styleViolations(css, STYLE_RULES.cssFontShorthand)).toEqual([]);
  });

  it('нет сырых hex/rgb/hsl ни в коде, ни в CSS', () => {
    for (const files of [code, css]) {
      expect(styleViolations(files, STYLE_RULES.hex)).toEqual([]);
      expect(styleViolations(files, STYLE_RULES.rgb)).toEqual([]);
    }
  });

  it('своих токенов web-next не объявляет — палитра и шкала живут в kit', () => {
    const own = Object.entries(css).filter(([, s]) => /--(?:bg\d|t\d|acc|fs-[\w-]+)\s*:/.test(s)).map(([p]) => p);
    expect(own, 'объявление токенов вне kit/src/styles/seidr.css').toEqual([]);
  });
});
