// SPRINT_LORE_PIPELINE_HOST/PL-09. Джоб web-next в CI убивался кодом 137 (OOM):
// контейнер раннера ограничен --memory=6g, а vitest по умолчанию поднимает
// столько воркеров, сколько видит ядер (на ci-server — 24), каждый со своим jsdom.
// Правило: в CI число воркеров vitest ограничено. kit живёт в AIDA/lorekit (K5-PACKAGE-DELIVERY, 25.11):
// его vitest.config.ts держит те же потолки (testTimeout 20 с, hookTimeout 30 с, maxWorkers 4 при CI) там.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(__dirname, '..', '..');
const cfg = (p: string) => readFileSync(resolve(repo, p), 'utf8');

// SPRINT_UXR_S11_TEST_OPT/CI-WEBNEXT-ISOLATION (14.11.2026): полный прогон web-next на
// ci-server, контейнер с --cpus 1.5 — красные 2 из 3 прогонов, все падения «Test timed out
// in 5000ms» (axe по витрине /kit, палитра, тяжёлые отрисовки); при --cpus 6 — 10 из 10
// зелёных. Код ни при чём: упирается лимит. У kit потолок 20 с с 07.11 (#869), у web-next
// оставался дефолт 5 с, а хуки — 10 с (локальные падения ci-scope/pipeline-host на setup).
// Правило: лимит — потолок от зависания, а не норма скорости, и он одинаков у kit и web-next.
describe('лимиты времени тестов — потолок от зависания, одинаковый у kit и web-next', () => {
  for (const file of ['web-next/vite.config.ts']) {
    it(`${file}: testTimeout не меньше 20 с`, () => {
      const n = Number(/testTimeout:\s*([\d_]+)/.exec(cfg(file))?.[1]?.replace(/_/g, ''));
      expect(n, 'testTimeout не задан — действует дефолт 5 с').toBeGreaterThanOrEqual(20_000);
    });
    it(`${file}: hookTimeout не меньше 30 с`, () => {
      const n = Number(/hookTimeout:\s*([\d_]+)/.exec(cfg(file))?.[1]?.replace(/_/g, ''));
      expect(n, 'hookTimeout не задан — действует дефолт 10 с').toBeGreaterThanOrEqual(30_000);
    });
  }
});

describe('vitest в CI не раздувает число воркеров (PL-09, OOM 137)', () => {
  for (const file of ['web-next/vite.config.ts']) {
    it(`${file}: maxWorkers ограничен при CI`, () => {
      const t = cfg(file);
      expect(t).toMatch(/maxWorkers:\s*process\.env\.CI\s*\?\s*\d+\s*:\s*undefined/);
      const n = Number(/maxWorkers:\s*process\.env\.CI\s*\?\s*(\d+)/.exec(t)?.[1]);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(4);
    });
  }
});
