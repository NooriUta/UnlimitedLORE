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

/**
 * S4-12 (SPRINT_UXR_S4_UI_SHELL_LISTS): единственное ОБЪЯВЛЕННОЕ расхождение с v1 —
 * токены, которые в v1 не дотягивали до WCAG AA 4.5:1 (гейт — contrast.test.ts).
 * v1 заморожен (D-2026-UXR-V2-FOLDER-V1-FROZEN), чинить там нельзя, поэтому v2
 * держит исправленное значение, а реестр — оба: v1 обязан по-прежнему иметь
 * старое (правка v1 всплывёт здесь), v2 — новое. Любое другое расхождение
 * по-прежнему валит сверку.
 */
const AA_V2_FIXES: Record<string, Record<string, { v1: string; v2: string }>> = {
  ':root': { '--dng': { v1: '#c85848', v2: '#cf6c5e' } },
  "[data-mode='light']": { '--acc': { v1: '#6b7a2a', v2: '#677528' } },
  "[data-theme='slate']": { '--dng': { v1: '#c85848', v2: '#cc6455' } },
  "[data-theme='lichen']": { '--dng': { v1: '#c05848', v2: '#c66758' } },
  "[data-theme='lichen'][data-mode='light']": { '--acc': { v1: '#3a8035', v2: '#397d34' } },
  "[data-theme='juniper']": { '--dng': { v1: '#c05040', v2: '#ca6c5f' } },
  "[data-theme='juniper'][data-mode='light']": {
    '--acc': { v1: '#1a8060', v2: '#197d5e' },
    '--suc': { v1: '#289850', v2: '#217e42' },
  },
  "[data-theme='warm-dark']": { '--dng': { v1: '#c85848', v2: '#cc6455' } },
};

/**
 * Палитры только v2 (S4-19): в замороженном v1 их нет и не будет. Сверке с v1
 * они не подлежат, но обязаны перекрыть ВСЁ ядро (иначе протечёт умолчание),
 * а контраст держит contrast.test.ts, как у остальных.
 */
const V2_ONLY_PALETTES = new Set(['mono']);

describe('S4-00b · палитры только v2 — полное ядро в обоих режимах', () => {
  for (const p of PALETTES.filter(x => V2_ONLY_PALETTES.has(x.id))) for (const mode of MODES) {
    it(`${p.id} / ${mode}`, () => {
      const b = v2.get(selectorOf(p.id, mode));
      expect(b).toBeDefined();
      for (const k of CORE) expect(b![k], k).toMatch(/^#[0-9a-f]{6}$/);
    });
  }
});

describe('S4-00a · палитры v2 = палитры v1', () => {
  for (const p of PALETTES.filter(x => !V2_ONLY_PALETTES.has(x.id))) {
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
        const fixes = AA_V2_FIXES[sel] ?? {};
        const expected = pick(a!);
        for (const [k, f] of Object.entries(fixes)) {
          expect(a![k], `${sel} ${k}: в v1 уже не ${f.v1} — пересмотрите реестр AA_V2_FIXES`).toBe(f.v1);
          expected[k] = f.v2;
        }
        expect(pick(b!)).toEqual(expected);
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
    // С S4-16 шкала v2 записана через множитель: `calc(12px * var(--fs-k))`
    // вместо `12px`. Сверять дословно больше нельзя — но и ослаблять сверку
    // нельзя: она держит обещание «кегли v2 = кегли v1». Поэтому сравниваются
    // САМИ СТУПЕНИ (число внутри calc), а множитель проверяется отдельно: он
    // по умолчанию 1, то есть у не выбиравшего человека размеры те же.
    const step = (v: string | undefined) => {
      const m = /calc\(\s*([\d.]+px)\s*\*\s*var\(--fs-k\)\s*\)/.exec(v ?? '');
      return m ? m[1] : v;
    };
    const pick = (m: Record<string, string>) => Object.fromEntries(SCALE.map(k => [k, step(m[k])]));
    expect(pick(v2.get(':root')!)).toEqual(pick(v1.get(':root')!));
    // Множитель — именно 1: иначе «те же ступени» ничего не значат.
    expect(v2.get(':root')!['--fs-k'], 'масштаб по умолчанию не 1').toBe('1');
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
  it('плотность: roomy по умолчанию (:root), у каждого режима свой блок', () => {
    expect(DENSITIES[0]).toBe('roomy');
    const root = v2.get(':root')!;
    for (const k of ['--row-h', '--pad-x', '--pad-y', '--gap']) expect(root[k], k).toBeDefined();
    for (const d of DENSITIES.slice(1)) {
      const b = v2.get(`[data-density='${d}']`);
      expect(b, `нет блока плотности ${d}`).toBeDefined();
      // roomy — самая просторная строка списка: остальные режимы плотнее.
      expect(Number.parseFloat(b!['--list-row-h'])).toBeLessThan(Number.parseFloat(root['--list-row-h']));
    }
  });

  it('pill/chip — радиус 999 токеном', () => {
    expect(v2.get(':root')!['--r-pill']).toBe('999px');
  });

  // D-2026-UXR-MOBILE-FOLLOWS-V1: видимый минимум (--tap) не растёт нигде —
  // 44 px на сенсоре даёт невидимая зона --hit, и решает её вид указателя.
  it('цель касания ≥44px на сенсоре — зоной --hit; видимый --tap везде 0 (плотный UI не растёт)', () => {
    expect(v2.get(':root')!['--tap']).toBe('0px');
    expect(v2.get(':root')!['--hit']).toBe('0px');
    const media = v2Css.match(/@media \(pointer: coarse\)\s*\{\s*:root\s*\{([^}]*)\}/);
    expect(media, 'нет @media для сенсора').not.toBeNull();
    const hit = media![1].match(/--hit:\s*(\d+)px/);
    expect(Number(hit?.[1])).toBeGreaterThanOrEqual(44);
    expect(media![1]).not.toMatch(/--tap/);
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

  for (const p of PALETTES.filter(x => !V2_ONLY_PALETTES.has(x.id))) {
    it(`${p.id}: swatch = var(--swatch-${p.id}) со значением v1`, () => {
      expect(p.swatch).toBe(`var(--swatch-${p.id})`);
      expect(v2.get(':root')![`--swatch-${p.id}`]).toBe(v1Swatch[p.id]);
    });
  }
});
