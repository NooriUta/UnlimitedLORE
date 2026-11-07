// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f: оболочка v2 обёрнута в ErrorBoundary
// Seiðr-kit и показывает плашку хранилища kit. Подключение самого kit (пакет,
// tokens.css, Dockerfile, CI) сторожит kit.test.ts (S4-00a).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import App from './App';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), 'utf8');

describe('web-next · устойчивость из Seiðr-kit', () => {
  it('оболочка завёрнута в ErrorBoundary kit и подключает StorageBanner', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/<ErrorBoundary/);
    expect(app).toMatch(/<StorageBanner/);
    expect(renderToString(<App path="/" />)).toContain('data-lore-app="v2"');
  });

  it('хранилище с откатом в память живёт в каталоге storage/ (гард S3-08)', () => {
    expect(read('storage/safe.ts')).toMatch(/createSafeStorage\(/);
  });
});
