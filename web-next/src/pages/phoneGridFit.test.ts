// SPRINT_UXR_S13_KIT4/K4-PHONE-PAGE-OVERFLOW — сетки экранов v2 не шире телефона.
//
// Корень переполнения витрины /kit на 300 px (349 при 300): раскладка страницы
// `repeat(auto-fit, minmax(320px, 1fr))` — на экране уже 320 колонка всё равно
// 320 и уезжает за край. То же у любой сетки «сколько влезет» с голым минимумом
// в пикселях, поэтому правило — на все CSS web-next, а не на одну витрину:
// минимум колонки пишется min(Npx, 100%). Правило kit — kit/src/styles/phoneFit.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

function autoTrackMins(src: string): string[] {
  return [...src.matchAll(/repeat\(\s*auto-(?:fill|fit)\s*,\s*minmax\(\s*((?:[^()]|\([^()]*\))+?)\s*,/g)].map(m => m[1]);
}

describe('K4-PHONE-PAGE-OVERFLOW · сетки web-next сжимаются до экрана', () => {
  const files = cssFiles(SRC);

  it('положительный контроль: CSS найдены, и витрина среди них с дорожками auto-fill', () => {
    const kit = files.find(f => f.endsWith('KitPage.css'));
    expect(kit, 'KitPage.css найден').toBeTruthy();
    expect(autoTrackMins(readFileSync(kit!, 'utf8')).length).toBeGreaterThan(0);
  });

  it('минимум колонки сетки «сколько влезет» — min(Npx, 100%), а не голые пиксели', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of autoTrackMins(src)) if (/^\d+(?:\.\d+)?px$/.test(m)) bad.push(`${relative(SRC, f)}: minmax(${m}, …)`);
    }
    expect(bad).toEqual([]);
  });
});
