// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00e — «/kit vs голый HTML».
// Голый HTML (demo/seidr-bare.html) и его снимок живут в репозитории kit (AIDA/lorekit,
// bare-html.test.tsx) — в пакет он не входит. Здесь, на стороне LORE, сверяется то, что
// видит потребитель: каждый класс sk-…, отрисованный на витрине /kit, описан в seidr.css
// установленного пакета (K5-PACKAGE-DELIVERY). И по слою: CSS web-next не определяет
// классы kit и не заводит своих токенов — вид элементов и тема живут ТОЛЬКО в seidr.css.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { KIT_CSS } from '../test/kitPaths';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import KitPage from './KitPage';

// vitest запускается из web-next/ (локально и в CI).
const WEB = process.cwd();
const KIT_CSS_TEXT = readFileSync(KIT_CSS, 'utf8');
/** Классы sk-…, которые упоминает CSS-слой kit (в селекторах). */
const cssClasses = (css: string) => new Set([...css.matchAll(/\.(sk-[\w-]+)/g)].map(m => m[1]));

function skClasses(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c.startsWith('sk-')) out.add(c);
  }
  return out;
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return p.endsWith('.css') ? [p] : [];
  });
}

beforeAll(() => {
  registerGameIcons(gameIcons);
});

describe('S4-00e · витрина /kit и голый HTML — один CSS-слой', () => {
  it('каждый класс kit, отрисованный на /kit, описан в seidr.css пакета', async () => {
    const { container } = render(<KitPage />);
    await waitFor(() => expect(container.querySelector('.sk-md .ProseMirror')).toBeTruthy());
    const onKit = skClasses(container.innerHTML);
    const inCss = cssClasses(KIT_CSS_TEXT);
    // Положительный контроль: обе стороны непусты и пересекаются по базовым.
    expect(onKit.size).toBeGreaterThan(20);
    expect([...inCss]).toEqual(expect.arrayContaining(['sk-pill', 'sk-state--error', 'sk-frame']));
    expect([...onKit].filter(c => !inCss.has(c)).sort()).toEqual([]);
  });

  it('CSS web-next — только раскладка: без правил для sk-… и без своих токенов', () => {
    const files = cssFiles(resolve(WEB, 'src'));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/\.sk-[\w-]/.test(body)) offenders.push(`${f}: правило для класса kit`);
      if (/(^|[;{\s])--[\w-]+\s*:/.test(body)) offenders.push(`${f}: свой токен (--…:)`);
    }
    expect(offenders).toEqual([]);
  });
});
