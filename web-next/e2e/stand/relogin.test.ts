// E2E-STAND · прогон 9033 (19.11.2026): набор смоука идёт ~31 мин, вход живёт ~15. Всё после истечения падало
// «Вы не опознаны» / «нет прав» — смоук краснел не из-за стенда. Сторож: каждый набор на общем входе обновляет
// вход перед сценарием, а вход учётки (asAccount) — перед открытием её страницы.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const specs = readdirSync(dir).filter(f => f.endsWith('.stand.ts'));

describe('смоук стенда не живёт на просроченном входе', () => {
  it('наборы найдены', () => expect(specs.length).toBeGreaterThan(3));
  for (const f of specs) {
    const src = readFileSync(join(dir, f), 'utf8');
    if (!src.includes('requireStand()')) continue; // свой вход (broker) или вход по учёткам (rbac → asAccount)
    it(`${f}: вход обновляется перед сценарием`, () => {
      expect(src).toContain('test.beforeEach(({ browser }) => keepLoginFresh(browser));');
    });
  }
  it('asAccount обновляет вход учётки перед её страницей', () => {
    const stand = readFileSync(join(dir, 'stand.ts'), 'utf8');
    expect(stand).toMatch(/asAccount[\s\S]*?await keepLoginFresh\(browser, file, account\);/);
  });
});
