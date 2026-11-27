// Сторож: в исходниках web-next и kit нет маркеров конфликта слияния.
// Повод 20.11.2026: мерж develop в feat/charts-batch-1 (cbd5ee1c, влит #1636) оставил в App.css блок
// «<<<<<<< HEAD … >>>>>>> origin/develop». tsc и vitest его не заметили, упала только `vite build`
// (lightningcss: Invalid empty selector) — и стала красной у каждого PR в develop, даже чисто бэкендового.
// Правило общее, не про один файл: маркер в любом исходнике ловится здесь, до сборки.
//
// Файлы читаются с диска, а не через import.meta.glob('?raw'): в vitest CSS-обработка выключена, и
// `*.css?raw` отдаёт пустую строку — сторож на glob прошёл бы на сломанном App.css (проверено 20.11).
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// K5-PACKAGE-DELIVERY: kit/ из репозитория ушёл в AIDA/lorekit — его исходники здесь не лежат,
// маркеры в них ловит сборка и CI самого kit.
const ROOTS = [join(__dirname, '..')];
const EXT = new Set(['.ts', '.tsx', '.css', '.json', '.html', '.md']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(extname(e.name))) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap(r => walk(r));

// Собрано из частей, чтобы сам этот файл не совпадал со своим же шаблоном.
const MARKER = new RegExp('^(' + '<'.repeat(7) + '|' + '>'.repeat(7) + ')( |\\r?$)|^' + '='.repeat(7) + '\\r?$');

describe('нет маркеров конфликта слияния', () => {
  it('сторож не слепой — видит App.css с содержимым', () => {
    const app = files.find(p => p.endsWith(join('src', 'App.css')));
    expect(app).toBeDefined();
    expect(readFileSync(app!, 'utf8').length).toBeGreaterThan(1000);
  });

  it('ни в одном исходнике', () => {
    const hits: string[] = [];
    for (const p of files) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (MARKER.test(line)) hits.push(`${relative(join(__dirname, '..', '..', '..'), p)}:${i + 1}`);
      });
    }
    expect(hits, 'разрешите конфликт: оставьте обе стороны или одну, но без маркеров').toEqual([]);
  });
});
