// Стенд 26.11.2026, прогон stand-e2e 11265 (v1.19.1): 76/76 сценариев pass, а джоба красная —
// upload-artifact@v3 «Create Artifact Container: socket hang up» ×5. Итог смоука должен быть итогом
// ТЕСТОВ: шлагбаум прода (release-guard «Смоук стенда зелёный на голове PR») смотрит на джобу, и
// сбой выгрузки скринов на Forgejo держал релиз при зелёных тестах.
// Правило: шаг выгрузки артефакта не роняет джобу; сами тесты — по-прежнему роняют.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const wf = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'lore-stand-e2e.yml'), 'utf8');

/** Блок шага по его имени: от «- name: …» до следующего шага того же уровня. */
function step(name: string): string {
  const start = wf.indexOf(`- name: ${name}`);
  if (start < 0) return '';
  const rest = wf.slice(start + 1);
  const next = rest.search(/\n\s{6}- (name|uses|run):/);
  return next < 0 ? wf.slice(start) : wf.slice(start, start + 1 + next);
}

describe('смоук стенда: выгрузка скринов не роняет итог', () => {
  it('шаг артефакта найден (положительный контроль)', () => {
    expect(step('Скрины и отчёт — артефакт')).toContain('actions/upload-artifact');
  });

  it('шаг артефакта — continue-on-error: true (литерал, Forgejo не принимает выражение)', () => {
    expect(step('Скрины и отчёт — артефакт')).toMatch(/\n\s+continue-on-error: true\s*\n/);
  });

  it('шаг самих тестов (npm run e2e:stand) continue-on-error не получил', () => {
    const blocks = wf.split(/\n\s{6}- name: /).filter(b => /npm run e2e:stand(?![:\w])/.test(b));
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(b, b.split('\n')[0]).not.toMatch(/continue-on-error: true/);
  });
});
