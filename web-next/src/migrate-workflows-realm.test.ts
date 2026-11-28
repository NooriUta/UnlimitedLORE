// Разовые миграции данных (migrate-*.yml): токен — в realm ТОГО стенда, куда идёт запрос.
// Дефект 28.11.2026: migrate-release-of-repository dry_run на препроде — «HTTP 401 — токен не принят»:
// workflow брал токен в realm прода (omilore), а бэкенд препрода принимает omilorePreprod (как LORE CD
// препрода, lore-cd.yml). Тот же промах был у migrate-qg-task-component-edge. Правило — для всех migrate-*.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wfDir = resolve(__dirname, '../../.github/workflows');
const migrations = readdirSync(wfDir).filter(f => /^migrate-.*\.yml$/.test(f));

describe('migrate-*.yml: realm токена по стенду', () => {
  it('миграции найдены', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(2);
  });

  for (const f of migrations) {
    it(`${f}: preprod → omilorePreprod, prod → omilore`, () => {
      const wf = readFileSync(resolve(wfDir, f), 'utf8');
      if (!/target:/.test(wf)) return; // без выбора стенда — правило не про него
      const line = wf.split(/\r?\n/).find(l => /^\s*LORE_OIDC_ISSUER:/.test(l)) ?? '';
      expect(line, `${f}: нет LORE_OIDC_ISSUER`).not.toBe('');
      expect(line).toContain("inputs.target == 'prod'");
      expect(line).toContain('/realms/omilorePreprod');
      expect(line).toMatch(/\/realms\/omilore'/);
    });
  }
});
