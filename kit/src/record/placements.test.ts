// S4-17 (решение владелицы 14.11.2026): «пока не делать модалку, но заложить возможность».
// Набор мест показа записи — ДАННЫЕ в одном месте (RECORD_PLACEMENTS): тип, проверка, меню kit,
// личная настройка и адрес web-next читают его. Новое место (modal) добавляется строкой в списке
// и своей отрисовкой, без правки каждого экрана. Сторож: литерал набора мест в коде больше нигде.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECORD_PLACEMENTS, isRecordPlacement } from './RecordDock';

describe('места показа записи — данными', () => {
  it('набор мест — один список; проверка понимает только его', () => {
    expect([...RECORD_PLACEMENTS]).toEqual(['left', 'right', 'bottom', 'full']);
    for (const p of RECORD_PLACEMENTS) expect(isRecordPlacement(p)).toBe(true);
    expect(isRecordPlacement('modal')).toBe(false);
    expect(isRecordPlacement('auto')).toBe(false);
    expect(isRecordPlacement(null)).toBe(false);
  });

  it('литерал набора мест нигде в коде kit и web-next, кроме объявления списка', () => {
    const root = join(process.cwd(), '..');
    const hits: string[] = [];
    const re = /'left'\s*[,|]\s*'right'\s*[,|]\s*'bottom'\s*[,|]\s*'full'/;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'test') walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        if (re.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length + 1).split('\\').join('/'));
      }
    };
    walk(join(root, 'kit', 'src'));
    walk(join(root, 'web-next', 'src'));
    expect(hits).toEqual(['kit/src/record/RecordDock.ts'.replace('.ts', '.tsx')]);
  });
});
