// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-12 — WCAG AA в обеих темах, для каждой палитры.
//
// axe в jsdom контраст не считает (нет раскладки и вычисленных цветов), поэтому
// гейт стоит на самих токенах seidr.css: всякая пара «текст на поверхности»,
// которую рисуют элементы kit, обязана давать ≥ 4.5:1 (1.4.3, обычный текст —
// шкала kit мелкая, base 12, крупного текста в смысле WCAG почти нет).
//
// Матрица пар (что реально встречается в разметке kit):
//   • текст и семантика (--t1…--t3, --acc, --suc, --wrn, --inf, --dng) — на
//     поверхностях --bg0 (страница), --bg1 (панели, шапка), --bg2 (карточки);
//   • --t1/--t2 — и на --bg3 (наведение/выбор строки, пункт меню под курсором);
//   • ссылка «к содержимому» — --bg0 на --acc (.sk-shell__skip);
//   • статусы --st-* — текст статуса в списке/доске/чипе (.sk-list__status,
//     .sk-board__head, .sk-schip) на --bg0…--bg2.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, MODES } from '../tokens/prefs';
import type { Mode, Palette } from '../tokens/prefs';
import { AA_TEXT, contrastRatio, relativeLuminance } from '../tokens/contrast';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, 'seidr.css'), 'utf8');

/** Блоки верхнего уровня вне @media → токены (как в tokens.test.ts). */
function blocks(src: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const flat = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ').replace(/"/g, "'");
    const vars = out.get(sel) ?? {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim().toLowerCase();
    out.set(sel, vars);
  }
  return out;
}

const map = blocks(css);

/** Токены, действующие на элементе с data-theme/data-mode — тем же каскадом, что в браузере. */
function themeTokens(palette: Palette, mode: Mode): Record<string, string> {
  const theme = palette === 'amber-forest' ? null : `[data-theme='${palette}']`;
  const layers = [':root'];
  if (mode === 'light') layers.push("[data-mode='light']");
  if (theme) layers.push(theme);
  if (theme && mode === 'light') layers.push(`${theme}[data-mode='light']`);
  return Object.assign({}, ...layers.map(sel => map.get(sel) ?? {}));
}

const TEXT = ['--t1', '--t2', '--t3', '--acc', '--suc', '--wrn', '--inf', '--dng'];
const SURFACES = ['--bg0', '--bg1', '--bg2'];
const HOVER_TEXT = ['--t1', '--t2'];
const STATUSES = [
  '--st-done', '--st-ready_for_deploy', '--st-active', '--st-partial', '--st-planned', '--st-design',
  '--st-todo', '--st-backlog', '--st-deferred', '--st-blocked', '--st-cancelled',
];

function pairs(t: Record<string, string>): [string, string][] {
  const out: [string, string][] = [];
  for (const fg of [...TEXT, ...STATUSES]) for (const bg of SURFACES) out.push([fg, bg]);
  for (const fg of HOVER_TEXT) out.push([fg, '--bg3']);
  out.push(['--bg0', '--acc']);
  return out.filter(([fg, bg]) => t[fg] !== undefined || t[bg] !== undefined);
}

describe('S4-12 · формула контраста', () => {
  it('крайние точки WCAG: чёрный/белый = 21, одинаковые = 1', () => {
    const black = `#${'0'.repeat(6)}`;
    const white = `#${'f'.repeat(6)}`;
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBe(1);
    expect(relativeLuminance(white)).toBe(1);
  });

  it('не-hex значение — громкая ошибка, а не «контраст NaN проходит»', () => {
    expect(() => relativeLuminance('var(--t1)')).toThrow(/#rrggbb/);
  });
});

describe('S4-12 · разбор видит все палитры (иначе гейт зелёный ни на чём)', () => {
  for (const p of PALETTES) for (const mode of MODES) {
    it(`${p.id} / ${mode}: у каждой пары матрицы есть оба цвета`, () => {
      const t = themeTokens(p.id, mode);
      for (const [fg, bg] of pairs(t)) {
        expect(t[fg], `${fg} не найден`).toMatch(/^#[0-9a-f]{6}$/);
        expect(t[bg], `${bg} не найден`).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(pairs(t).length).toBe((TEXT.length + STATUSES.length) * SURFACES.length + HOVER_TEXT.length + 1);
    });
  }
});

describe('S4-12 · WCAG AA (4.5:1) — каждая палитра в обоих режимах', () => {
  for (const p of PALETTES) for (const mode of MODES) {
    it(`${p.id} / ${mode}`, () => {
      const t = themeTokens(p.id, mode);
      const fails = pairs(t)
        .map(([fg, bg]) => ({ fg, bg, r: contrastRatio(t[fg], t[bg]) }))
        .filter(x => x.r < AA_TEXT)
        .map(x => `${x.fg} (${t[x.fg]}) на ${x.bg} (${t[x.bg]}) = ${x.r.toFixed(2)}`);
      expect(fails).toEqual([]);
    });
  }
});
