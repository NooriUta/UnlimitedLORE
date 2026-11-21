// Владелица 21.11.2026: «проверь, что ни одна связь не ведёт в админку из общих поверхностей». Сторож по исходникам:
// вне src/admin ни одна ссылка не ведёт в админку (/admin, ?mod=admin, adm=…). Разрешены только сам вход (пункт левого
// меню для admin/superadmin — V2Shell, v2Config) и разбор старых адресов /admin (App.tsx).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src');
const ALLOWED = new Set(['App.tsx', join('shell', 'V2Shell.tsx'), join('shell', 'v2Config.ts')]);
const files = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (n === 'admin' ? [] : files(p)) : /.(ts|tsx)$/.test(n) && !/.test./.test(n) ? [p] : [];
});
const LINK = /['`"]/admin[?/'`"]|mod=admin|[?&]adm=|'adm-open'/;

describe('общие поверхности не ведут в админку', () => {
  it('ни одной ссылки в админку вне src/admin (кроме входа и разбора старых адресов)', () => {
    const bad = files(ROOT)
      .filter(f => !ALLOWED.has(f.slice(ROOT.length + 1)))
      .flatMap(f => readFileSync(f, 'utf8').split('
').map((l, i) => ({ f, i, l })))
      .filter(x => LINK.test(x.l) && !/^s*(//|*)/.test(x.l))
      .map(x => `${x.f.slice(ROOT.length + 1)}:${x.i + 1}: ${x.l.trim()}`);
    expect(bad).toEqual([]);
  });
});
