// Сторож начертаний (08.11, скрин владелицы после v1.17.0: «почему все шрифты скачут»).
// Причина была в том, что CSS kit просит Manrope 700 и IBM Plex Mono 600, а
// подключены только 400/600 и 400: браузер дорисовывал жирный сам, и один и тот
// же текст выглядел по-разному. Правило: каждая жирность из seidr.css — с файлом.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/../kit/src/styles/seidr.css`, 'utf8');
const app = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');
const imported = (pkg: string) => new Set([...app.matchAll(new RegExp(String.raw`@fontsource/${pkg}/(\d{3})\.css`, 'g'))].map(m => Number(m[1])));

/** Жирности правил: [вес, моно ли правило]. */
function weights(src: string): { w: number; mono: boolean }[] {
  const out: { w: number; mono: boolean }[] = [];
  for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g)) {
    const body = m[1];
    const mono = /font-family:\s*var\(--mono\)/.test(body) || /font:[^;]*var\(--mono\)/.test(body);
    const display = /var\(--display\)/.test(body);
    if (display) continue; // Unbounded 800 — шрифт заголовков, свой файл
    for (const x of body.matchAll(/font-weight:\s*(\d{3})/g)) out.push({ w: Number(x[1]), mono });
    for (const x of body.matchAll(/font:\s*(\d{3})\s/g)) out.push({ w: Number(x[1]), mono });
  }
  return out;
}

describe('начертания шрифтов — каждая жирность из CSS kit подключена файлом', () => {
  it('положительный контроль: разбор видит веса и моно', () => {
    expect(weights('.a { font-weight: 700; } .b { font-family: var(--mono); font-weight: 600; }')).toEqual([{ w: 700, mono: false }, { w: 600, mono: true }]);
  });
  it('Manrope: все веса обычного текста (и 700 для <b>, <strong>, <th>)', () => {
    const need = new Set([400, 700, ...weights(css).filter(x => !x.mono).map(x => x.w)].filter(w => w !== 800));
    const have = imported('manrope');
    expect([...need].filter(w => !have.has(w)).sort()).toEqual([]);
  });
  it('IBM Plex Mono: все веса моноширинных правил', () => {
    const need = new Set([400, ...weights(css).filter(x => x.mono).map(x => x.w)]);
    const have = imported('ibm-plex-mono');
    expect([...need].filter(w => !have.has(w)).sort()).toEqual([]);
  });
});
