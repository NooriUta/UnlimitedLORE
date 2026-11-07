// D-2026-UXR-KIT-REACT: web-next своих элементов не держит — импортирует
// Seiðr-kit (kit/ в корне). SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f: оболочка v2
// обёрнута в ErrorBoundary kit и показывает плашку хранилища kit.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import App from './App';

const here = dirname(fileURLToPath(import.meta.url));
const webNext = resolve(here, '..');
const repo = resolve(webNext, '..');
const read = (p: string) => readFileSync(p, 'utf8');

describe('web-next импортирует Seiðr-kit', () => {
  it('зависимость @seidr/kit — локальный пакет ../kit', () => {
    const pkg = JSON.parse(read(resolve(webNext, 'package.json')));
    expect(pkg.dependencies['@seidr/kit']).toBe('file:../kit');
  });

  it('токены берутся из kit/src/styles/seidr.css, своей копии в web-next нет', () => {
    expect(existsSync(resolve(repo, 'kit/src/styles/seidr.css'))).toBe(true);
    expect(existsSync(resolve(here, 'styles/tokens.css'))).toBe(false);
    expect(read(resolve(here, 'App.tsx'))).toMatch(/@seidr\/kit\/styles\/seidr\.css/);
  });

  it('оболочка завёрнута в ErrorBoundary kit и подключает StorageBanner', () => {
    const app = read(resolve(here, 'App.tsx'));
    expect(app).toMatch(/<ErrorBoundary/);
    expect(app).toMatch(/<StorageBanner/);
    expect(renderToString(<App />)).toContain('data-lore-app="v2"');
  });

  it('образ v2 копирует kit рядом с web-next (file:../kit резолвится в /kit)', () => {
    const df = read(resolve(webNext, 'Dockerfile'));
    expect(df).toMatch(/^COPY kit\/package\.json \/kit\/package\.json$/m);
    expect(df).toMatch(/^COPY kit\/src \/kit\/src$/m);
  });

  it('frontend-ci гоняет тесты и typecheck kit', () => {
    const ci = read(resolve(repo, '.github/workflows/frontend-ci.yml'));
    const job = ci.split(/^ {2}web-next:\s*$/m)[1] ?? '';
    expect(job).toMatch(/working-directory: kit/);
    expect(job).toMatch(/npm run typecheck/);
  });
});
