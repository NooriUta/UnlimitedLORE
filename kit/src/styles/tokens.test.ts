// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a: токены и тема Seiðr-kit — один источник с v1.
//
// Токены живут в kit/src/styles/seidr.css (D-2026-UXR-KIT-REACT), web-next
// берёт их оттуда. v1 (корневой src/) заморожен (D-2026-UXR-V2-FOLDER-V1-FROZEN),
// а образ v2 его исходников не видит, поэтому значения перенесены копией. Копия без
// сверки тихо расходится: правка контраста в v1 (как MOB-12) не дошла бы до v2,
// и два веба одного продукта выглядели бы по-разному. Этот тест и есть
// «один источник»: каждая палитра v1 (тёмная и светлая), шкала --fs-* и
// шрифты обязаны совпадать значение-в-значение.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, MODES, DENSITIES } from '../tokens/prefs';

const here = dirname(fileURLToPath(import.meta.url));
const v1Css = readFileSync(resolve(here, '../../../src/styles/tokens.css'), 'utf8');
const v2Css = readFileSync(resolve(here, 'seidr.css'), 'utf8');

/** Блоки верхнего уровня `селектор { … }` → карта токенов (последний блок с тем же селектором дописывает). */
function blocks(css: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Только блоки вне @media: вырезаем @media целиком (сравниваем их отдельно).
  const flat = clean.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const sel = m[1].trim().replace(/\s+/g, ' ').replace(/"/g, "'");
    const vars = out.get(sel) ?? {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim().toLowerCase();
    out.set(sel, vars);
  }
  return out;
}

const v1 = blocks(v1Css);
const v2 = blocks(v2Css);

/** Ядро палитры: то, что меняется от темы к теме. */
const CORE = ['--bg0', '--bg1', '--bg2', '--bg3', '--bd', '--bdh', '--t1', '--t2', '--t3', '--acc', '--suc', '--wrn', '--inf', '--dng'];
const SCALE = ['--fs-2xs', '--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl', '--fs-touch-input'];
const FONTS = ['--font', '--mono', '--display'];

const selectorOf = (palette: string, mode: string) => {
  const t = palette === 'amber-forest' ? '' : `[data-theme='${palette}']`;
  const md = mode === 'light' ? "[data-mode='light']" : '';
  return (t + md) || ':root';
};

describe('S4-00a · сам разбор видит токены (иначе сверка «зелёная» ни на чём)', () => {
  it('в v1 и v2 найден :root с ядром палитры', () => {
    for (const map of [v1, v2]) {
      const root = map.get(':root');
      expect(root, ':root не найден').toBeDefined();
      for (const k of CORE) expect(root![k], k).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('S4-00a · палитры v2 = палитры v1', () => {
  for (const p of PALETTES) {
    for (const mode of MODES) {
      const sel = selectorOf(p.id, mode);
      it(`${p.id} / ${mode} (${sel})`, () => {
        const a = v1.get(sel);
        const b = v2.get(sel);
        expect(a, `в v1 нет блока ${sel}`).toBeDefined();
        expect(b, `в v2 нет блока ${sel}`).toBeDefined();
        // amber-forest dark живёт в :root; остальные палитры обязаны
        // перекрыть ВСЁ ядро, иначе протечёт значение умолчания.
        const pick = (m: Record<string, string>) => Object.fromEntries(CORE.filter(k => k in m).map(k => [k, m[k]]));
        expect(pick(b!)).toEqual(pick(a!));
        if (sel !== ':root' && sel !== "[data-mode='light']") expect(Object.keys(pick(b!)).sort()).toEqual([...CORE].sort());
      });
    }
  }

  it('светлый режим объявляет color-scheme: light, тёмный — dark', () => {
    expect(v2Css).toMatch(/\[data-mode='light'\]\s*\{[^}]*color-scheme:\s*light/);
    expect(v2Css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/);
  });
});

describe('S4-00a · шкала и шрифты = v1', () => {
  it('шкала --fs-* совпадает ступень-в-ступень', () => {
    const pick = (m: Record<string, string>) => Object.fromEntries(SCALE.map(k => [k, m[k]]));
    expect(pick(v2.get(':root')!)).toEqual(pick(v1.get(':root')!));
  });

  it('гарнитуры: Manrope / IBM Plex Mono / Unbounded — как в v1', () => {
    const pick = (m: Record<string, string>) => Object.fromEntries(FONTS.map(k => [k, m[k]]));
    expect(pick(v2.get(':root')!)).toEqual(pick(v1.get(':root')!));
    expect(v2.get(':root')!['--display']).toContain('unbounded');
  });

  it('база интерфейса — 12px (--fs-base), а не браузерные 16', () => {
    expect(v2Css).toMatch(/body\s*\{[^}]*font-size:\s*var\(--fs-base\)/);
  });
});

describe('S4-00a · плотность и касание', () => {
  it('плотность: компактная по умолчанию, у каждого режима свой блок', () => {
    expect(DENSITIES[0]).toBe('compact');
    const root = v2.get(':root')!;
    for (const k of ['--row-h', '--pad-x', '--pad-y', '--gap']) expect(root[k], k).toBeDefined();
    for (const d of DENSITIES.slice(1)) {
      const b = v2.get(`[data-density='${d}']`);
      expect(b, `нет блока плотности ${d}`).toBeDefined();
      expect(Number.parseFloat(b!['--row-h'])).toBeGreaterThan(Number.parseFloat(root['--row-h']));
    }
  });

  it('pill/chip — радиус 999 токеном', () => {
    expect(v2.get(':root')!['--r-pill']).toBe('999px');
  });

  it('цель касания ≥44px на сенсоре и узком экране, на десктопе 0 (плотный UI не растёт)', () => {
    expect(v2.get(':root')!['--tap']).toBe('0px');
    const media = v2Css.match(/@media \(pointer: coarse\), \(max-width: 768px\)\s*\{\s*:root\s*\{([^}]*)\}/);
    expect(media, 'нет @media для сенсора').not.toBeNull();
    const tap = media![1].match(/--tap:\s*(\d+)px/);
    expect(Number(tap?.[1])).toBeGreaterThanOrEqual(44);
  });
});

describe('S4-00a · образцы палитр в выборе темы — тоже токены и тоже из v1', () => {
  // v1 держит образцы hex-строками в src/theme/prefs.ts; в kit hex в TS запрещён
  // (STYLE-01), поэтому образец — токен --swatch-<палитра> в seidr.css.
  const v1Prefs = readFileSync(resolve(here, '../../../src/theme/prefs.ts'), 'utf8');
  const v1Swatch = Object.fromEntries(
    [...v1Prefs.matchAll(/id:\s*'([\w-]+)'[^}]*swatch:\s*'(#[0-9a-fA-F]{6})'/g)].map(m => [m[1], m[2].toLowerCase()]),
  );

  it('разбор prefs.ts v1 видит все пять образцов', () => {
    expect(Object.keys(v1Swatch)).toHaveLength(5);
  });

  for (const p of PALETTES) {
    it(`${p.id}: swatch = var(--swatch-${p.id}) со значением v1`, () => {
      expect(p.swatch).toBe(`var(--swatch-${p.id})`);
      expect(v2.get(':root')![`--swatch-${p.id}`]).toBe(v1Swatch[p.id]);
    });
  }
});
