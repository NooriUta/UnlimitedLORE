// SPRINT_UXR_S10_SEIDR_KIT/K-08 — выдача: файлы бандла лежат в репо
// (kit/dist/seidr-kit.js + seidr-kit.css) и соответствуют версии пакета.
// Пересборка: `npm run build:bundle` в kit/. Тест ловит «забыли пересобрать
// после поднятия версии» и «бандл тянет React снаружи» (single-file HTML без
// сборщика его не найдёт).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pkg from '../../package.json';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const js = existsSync(`${DIST}seidr-kit.js`) ? readFileSync(`${DIST}seidr-kit.js`, 'utf8') : '';
const css = existsSync(`${DIST}seidr-kit.css`) ? readFileSync(`${DIST}seidr-kit.css`, 'utf8') : '';

describe('K-08 · бандл kit/dist в репо', () => {
  it('оба файла есть и не пусты', () => {
    expect(js.length).toBeGreaterThan(1000);
    expect(css.length).toBeGreaterThan(1000);
  });

  it('бандл собран из текущей версии пакета (баннер и строка версии)', () => {
    expect(js.match(/seidr-kit v(\d+\.\d+\.\d+)/)?.[1]).toBe(pkg.version);
    const lit = new RegExp('[`"\']' + pkg.version.replace(/\./g, '\\.') + '[`"\']');
    expect(js).toMatch(lit);
  });

  it('ESM: экспортирует SeidrKit и mount', () => {
    expect(js).toMatch(/export\s*\{[^}]*\bSeidrKit\b/);
    expect(js).toMatch(/export\s*\{[^}]*\bmount\b/);
  });

  // Операторы import верхнего уровня (не слово «from» внутри строк mermaid).
  const STATIC_IMPORT = /(?:^|;)\s*import\s*(?:(?:[\w$]+|\{[^}]*\}|\*\s*as\s*[\w$]+)(?:\s*,\s*(?:\{[^}]*\}|\*\s*as\s*[\w$]+))?\s*from\s*)?["'`]([^"'`]+)["'`]/gm;
  const DYNAMIC_IMPORT = /\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  const imports = (s: string) => [...s.matchAll(STATIC_IMPORT), ...s.matchAll(DYNAMIC_IMPORT)].map(m => m[1]);

  it('положительный контроль детектора импортов', () => {
    expect(imports('import{a as b}from"react";import"x.css";const c=import("./chunk-1.js");')).toEqual(['react', 'x.css', './chunk-1.js']);
    expect(imports('var s=`can only receive input from a ${r}`;')).toEqual([]);
  });

  it('React внутри и один файл: никаких импортов вовсе (ни пакетов, ни чанков)', () => {
    expect(imports(js)).toEqual([]);
  });

  it('CSS — слой Seiðr (токены и шкала шрифтов)', () => {
    expect(css).toMatch(/--fs-base/);
    expect(css).toMatch(/--acc/);
    expect(css).toMatch(/\.sk-mount/);
  });
});
