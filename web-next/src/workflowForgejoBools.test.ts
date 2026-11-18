// Сторож: поля-флаги workflow — только литералы true/false.
//
// 18.11.2026: смоук стенда (lore-stand-e2e.yml) перестал запускаться вовсе — на push в preprod Forgejo ставил
// «failure» без единой задачи. Запуск по кнопке вернул причину: «invalid jobs: yaml: unmarshal errors: line 116:
// cannot unmarshal !!str `${{ git...` into bool». GitHub принимает выражение в continue-on-error, Forgejo — нет, и
// отбрасывает весь файл молча (SPRINT_UXR_S11_TEST_OPT/E2E-STAND). Правило на все workflow, не на один файл.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows');
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

describe('workflow: флаги — литералы, выражения Forgejo в них не разбирает', () => {
  it('файлы найдены', () => expect(files.length).toBeGreaterThan(5));
  for (const f of files) {
    it(f, () => {
      const lines = readFileSync(join(dir, f), 'utf8').split(/\r?\n/);
      const bad = lines
        .map((l, i) => ({ l, n: i + 1 }))
        .filter(({ l }) => /^\s*(continue-on-error|cancel-in-progress|fail-fast):\s*\$\{\{/.test(l));
      expect(bad.map((b) => `${f}:${b.n}: ${b.l.trim()}`)).toEqual([]);
    });
  }
});
