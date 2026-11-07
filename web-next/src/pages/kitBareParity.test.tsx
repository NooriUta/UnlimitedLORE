// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00e — «/kit vs голый HTML».
// Голый HTML (kit/demo/seidr-bare.html — снимок, его держит
// kit/src/styles/bare-html.test.tsx) на одном seidr.css обязан показывать всё,
// что показывает витрина /kit: каждый класс sk-…, отрисованный на /kit, есть и
// в снимке. И наоборот по слою: CSS web-next не определяет классы kit и не
// заводит своих токенов — вид элементов и тема живут ТОЛЬКО в seidr.css.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import KitPage from './KitPage';

// vitest запускается из web-next/ (локально и в CI); kit — соседний каталог.
const WEB = process.cwd();
const BARE = readFileSync(resolve(WEB, '../kit/demo/seidr-bare.html'), 'utf8');

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
  it('каждый класс kit, отрисованный на /kit, есть в снимке голого HTML', async () => {
    const { container } = render(<KitPage />);
    await waitFor(() => expect(container.querySelector('.sk-md .ProseMirror')).toBeTruthy());
    const onKit = skClasses(container.innerHTML);
    const onBare = skClasses(BARE);
    // Положительный контроль: обе стороны непусты и пересекаются по базовым.
    expect(onKit.size).toBeGreaterThan(20);
    expect([...onBare]).toEqual(expect.arrayContaining(['sk-pill', 'sk-state--error', 'sk-frame']));
    expect([...onKit].filter(c => !onBare.has(c)).sort()).toEqual([]);
  });

  it('голый HTML подключает seidr.css kit, а не копию', () => {
    expect(BARE).toMatch(/<link rel="stylesheet" href="\.\.\/src\/styles\/seidr\.css">/);
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
