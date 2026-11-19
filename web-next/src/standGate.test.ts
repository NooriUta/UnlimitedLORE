// Сторож шлагбаума «препрод → прод» (SPRINT_UXR_S11_TEST_OPT/E2E-STAND).
//
// Владелица 19.11.2026: «если playwright работает пиши все тесты на него и включай в проверку между преподом
// и продом». PR в main (релиз из preprod) не проходит, пока смоук стенда на его голове не зелёный, а сценарии
// выпуска (release.stand.ts) входят в этот смоук. Сторож держит обе половины: шаг в release-guard.yml и сценарии.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const guard = readFileSync(resolve(root, '.github/workflows/release-guard.yml'), 'utf8');

describe('шлагбаум прода: смоук стенда на голове PR в main', () => {
  it('release-guard на PR в main ждёт зелёный смоук стенда по голове PR', () => {
    expect(guard).toMatch(/branches: \[ "main" \]/);
    expect(guard).toContain('bash .github/scripts/stand-gate.sh "${{ github.event.pull_request.head.sha }}"');
  });
  it('сторож умеет краснеть: самопроверка идёт отдельным шагом', () => {
    expect(guard).toContain('bash .github/scripts/stand-gate.sh --selftest');
    expect(existsSync(resolve(root, '.github/scripts/stand-gate.sh'))).toBe(true);
  });
  it('сценарии выпуска входят в смоук стенда (R1 v2, R2 телефон, R3 ссылки)', () => {
    const spec = readFileSync(resolve(root, 'web-next/e2e/stand/release.stand.ts'), 'utf8');
    for (const code of ['R1 ', 'R2 ', 'R3 ']) expect(spec).toContain(`test('${code}`);
  });
});
