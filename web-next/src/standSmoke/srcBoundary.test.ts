// Образ фронта (Dockerfile) копирует только web-next/src, а `npm run build` гоняет tsc по src.
// Импорт из ../e2e (или любого пути вне src, кроме пакетов) проходит vitest локально, но роняет
// сборку образа: так упал промо-PR #1412 (src/standSmoke/rbac.test.ts → ../../e2e/stand/tokens).
// Тот же класс, что #1389 (summary.ts вне src). Сторож: из src не импортируют ничего из e2e.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

describe('src не тянет файлы из e2e — образ копирует только src', () => {
  it('ни один файл src не импортирует из e2e/', () => {
    const bad = walk(join(process.cwd(), 'src')).filter(f =>
      /from\s+['"](\.\.\/)+e2e\//.test(readFileSync(f, 'utf8')));
    expect(bad.map(f => f.replace(process.cwd(), ''))).toEqual([]);
  });
});
