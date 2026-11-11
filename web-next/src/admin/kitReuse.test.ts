// SPRINT_UXR_S7B_ADMIN/S7B-25 — обратная граница K-14: приложение не держит
// своих копий кубиков kit. Подтверждение словом — у kit DiffPreview (confirm),
// пустое состояние — kit EmptyState. Сторож — греп по исходникам админки:
// самодельный «sk-state» или своё поле подтверждения снова вырастут незаметно.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = __dirname;
const screens = readdirSync(DIR).filter(f => f.endsWith('.tsx') && !f.includes('.test.'));
const src = (f: string) => readFileSync(join(DIR, f), 'utf8');

describe('S7B-25 · админка берёт кубики у kit, а не рисует свои', () => {
  it('нет самодельных пустых состояний (разметка sk-state руками)', () => {
    const offenders = screens.filter(f => /className="sk-state/.test(src(f)));
    expect(offenders).toEqual([]);
  });

  it('нет своего поля подтверждения словом — только confirm у kit DiffPreview', () => {
    const offenders = screens.filter(f => /adm-danger-confirm|isConfirmed\(/.test(src(f)));
    expect(offenders).toEqual([]);
    expect(src('DangerBatch.tsx')).toMatch(/<DiffPreview[^>]*\bconfirm=\{/s);
  });
});
