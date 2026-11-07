// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00e — общий CSS-слой Seiðr одним файлом.
// Один и тот же seidr.css подключают web-next (import), прототипы и голый HTML
// (<link>). Значит: (1) у kit ровно один свой CSS-файл; (2) он самодостаточен —
// без @import и url(), которые голый HTML с file:// или CSP 'self' не догрузит;
// (3) у каждого класса sk-…, который ставят компоненты kit, есть правило в
// этом файле — иначе «тот же вид» у голого HTML и у React расходится молча.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { definedClasses } from '../test/cssClasses';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(SRC, 'styles', 'seidr.css'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(SRC).map(p => relative(SRC, p).split(sep).join('/'));
const sources = files.filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.startsWith('test/'));


describe('S4-00e · seidr.css — единственный CSS-слой kit', () => {
  it('положительный контроль: исходники kit найдены и читаются', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources).toContain('elements/Pill.tsx');
    expect(css).toMatch(/--fs-base/);
  });

  it('свой CSS у kit — ровно один файл styles/seidr.css', () => {
    expect(files.filter(f => f.endsWith('.css'))).toEqual(['styles/seidr.css']);
  });

  it('компоненты kit не подключают свой CSS (вид — только из seidr.css)', () => {
    const offenders = sources.filter(f => /import\s+['"]\.{1,2}\/[^'"]+\.css['"]/.test(readFileSync(join(SRC, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('файл самодостаточен для <link> из голого HTML: без @import и url()', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/@import/);
    expect(body).not.toMatch(/url\(/);
  });

  it('у каждого класса sk-…, который ставят компоненты kit, есть правило в seidr.css', () => {
    const defined = definedClasses(css);
    const used = new Set<string>();
    for (const f of sources) {
      const text = readFileSync(join(SRC, f), 'utf8');
      // Префиксы шаблонов (`sk-pill--${v}`) оканчиваются дефисом — их варианты
      // ловит снимок голого HTML (bare-html.test.tsx), здесь — полные имена.
      for (const m of text.matchAll(/\bsk-[a-z0-9_-]*[a-z0-9]\b(?!-)/g)) used.add(m[0]);
    }
    // Положительный контроль сборщика: базовые классы найдены.
    expect([...used]).toEqual(expect.arrayContaining(['sk-pill', 'sk-iconbtn', 'sk-state', 'sk-prose', 'sk-frame']));
    const missing = [...used].filter(c => !defined.has(c)).sort();
    expect(missing).toEqual([]);
  });
});
