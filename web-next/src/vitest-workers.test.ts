// SPRINT_LORE_PIPELINE_HOST/PL-09. Джоб web-next в CI убивался кодом 137 (OOM):
// контейнер раннера ограничен --memory=6g, а vitest по умолчанию поднимает
// столько воркеров, сколько видит ядер (на ci-server — 24), каждый со своим jsdom.
// Правило: в CI число воркеров vitest ограничено и у kit, и у web-next.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(__dirname, '..', '..');
const cfg = (p: string) => readFileSync(resolve(repo, p), 'utf8');

describe('vitest в CI не раздувает число воркеров (PL-09, OOM 137)', () => {
  for (const file of ['kit/vitest.config.ts', 'web-next/vite.config.ts']) {
    it(`${file}: maxWorkers ограничен при CI`, () => {
      const t = cfg(file);
      expect(t).toMatch(/maxWorkers:\s*process\.env\.CI\s*\?\s*\d+\s*:\s*undefined/);
      const n = Number(/maxWorkers:\s*process\.env\.CI\s*\?\s*(\d+)/.exec(t)?.[1]);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(4);
    });
  }
});
