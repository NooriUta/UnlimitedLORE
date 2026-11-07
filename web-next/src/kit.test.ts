// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a, D-2026-UXR-KIT-REACT: web-next своей
// копии токенов и элементов не держит — он импортирует Seiðr-kit (kit/ в корне
// репо). Гварды на файлах: поломка подключения не видна tsc, если копия
// токенов тихо осталась в web-next, а в образ kit не попал.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, resolvePrefs } from '@seidr/kit';

const here = dirname(fileURLToPath(import.meta.url));
const webNext = resolve(here, '..');
const read = (p: string) => readFileSync(resolve(webNext, p), 'utf8');

describe('web-next ← @seidr/kit', () => {
  it('kit подключён пакетом из ../kit', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['@seidr/kit']).toBe('file:../kit');
  });

  it('пакет kit разрешается: тема и палитры приходят из kit', () => {
    expect(PALETTES.map(p => p.id)).toContain('amber-forest');
    expect(resolvePrefs({}).palette).toBe('amber-forest');
  });

  it('собственного tokens.css в web-next больше нет', () => {
    expect(existsSync(resolve(webNext, 'src/styles/tokens.css'))).toBe(false);
  });

  it('App подключает единый CSS-слой kit и шрифты Seiðr (Manrope, IBM Plex Mono, Unbounded 800)', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/import '@seidr\/kit\/styles\/seidr\.css'/);
    expect(app).toMatch(/@fontsource\/manrope\//);
    expect(app).toMatch(/@fontsource\/ibm-plex-mono\//);
    expect(app).toMatch(/@fontsource\/unbounded\/800\.css/);
  });

  it('тема ставится до первого рендера из сохранённого выбора (как в v1)', () => {
    const main = read('src/main.tsx');
    expect(main).toMatch(/applyTheme\(\s*document\.documentElement/);
    expect(main).toMatch(/resolvePrefs\(/);
  });

  it('vite не тянет вторую копию React из kit/node_modules', () => {
    const cfg = read('vite.config.ts');
    expect(cfg).toMatch(/dedupe:\s*\[[^\]]*'react'/);
  });

  it('tsc берёт типы React для исходников kit из web-next, а не ищет вверх от kit/', () => {
    const ts = read('tsconfig.json');
    expect(ts).toMatch(/"react":\s*\["\.\/node_modules\/@types\/react"\]/);
    expect(ts).toMatch(/"react\/\*":\s*\["\.\/node_modules\/@types\/react\/\*"\]/);
  });
});

describe('образ web-next собирает и kit', () => {
  it('Dockerfile копирует kit поимённо (без локальных node_modules)', () => {
    const df = read('Dockerfile');
    expect(df).toMatch(/^COPY kit\/package\.json /m);
    expect(df).toMatch(/^COPY kit\/src /m);
    expect(df).not.toMatch(/^COPY kit\/? /m);
  });
});
