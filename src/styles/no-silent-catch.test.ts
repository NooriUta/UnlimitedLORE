import { describe, it, expect } from 'vitest';

/**
 * SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-07 · «сбой загрузки не выдаётся за пусто».
 *
 * `.catch(() => {})` и `.catch(() => setX([]))` превращают сбой в «ничего нет»:
 * экран рисует пустую таблицу, «0» или вовсе ничего, хотя данные могут
 * существовать — их просто не удалось получить. Тест читает ИСХОДНИКИ и
 * запрещает обе формы.
 *
 * Осознанная деградация (подсказка, пикер, бейдж) разрешена, но только с
 * объяснением внутри: `.catch(() => { /* что именно деградирует *\/ })` —
 * тогда это решение, а не забытый обработчик. Остальное — `onError(e)` или
 * своё состояние ошибки с `LoadError`.
 */
const sources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Аргумент обработчика: `()`, `(_)`, `(_e)`, `_`, `e`. */
const ARG = String.raw`(?:\(\s*_?\w*\s*\)|_?\w+)`;
/** «Пустое» значение, которым сбой подменяют: [], {}, new Map(), 0, null. */
const EMPTY = String.raw`(?:\[\]|\{\}|new Map\(\)|0|null)`;

const SWALLOW = new RegExp(String.raw`\.catch\(\s*${ARG}\s*=>\s*\{\s*\}\s*\)`, 'g');
/** AH-07 (зона 4): `.catch(() => [] as T[])` — та же подмена, только значением: упавший срез
 *  вливается в Promise.all пустым, и экран рисует нули. */
const AS_EMPTY_VALUE = new RegExp(String.raw`\.catch\(\s*${ARG}\s*=>\s*(?:\[\]|new Map\(\)|0|null|\(\{\}\))(?:\s+as\s+[^)]+)?\s*\)`, 'g');
const AS_EMPTY = new RegExp(String.raw`\.catch\(\s*${ARG}\s*=>\s*set[A-Z]\w*\(\s*${EMPTY}\s*\)\s*\)`, 'g');

function offendersOf(re: RegExp): string[] {
  const out: string[] = [];
  for (const [path, src] of Object.entries(sources)) {
    const lines: number[] = [];
    for (const m of src.matchAll(re)) lines.push(src.slice(0, m.index).split('\n').length);
    if (lines.length) out.push(`${path}:${lines.join(',')}`);
  }
  return out;
}

describe('AH-07 · сбой загрузки не выдаётся за пусто', () => {
  it('тест видит исходники (иначе «0 нарушителей» ничего не значит)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('регулярки ловят обе формы (положительный контроль)', () => {
    const bad = [
      'p.catch(() => {})',
      'p.catch(() => setRows([]))',
      'p.catch(_e => setMap(new Map()))',
      'p.catch(() => setCount(0))',
      'p.catch(() => setDoc(null))',
      'p.catch(() => setMatrix({}))',
      'p.catch(() => [] as T[])',
      'p.catch(() => null)',
    ];
    for (const s of bad) {
      expect(s.match(new RegExp(SWALLOW.source)) || s.match(new RegExp(AS_EMPTY.source)) || s.match(new RegExp(AS_EMPTY_VALUE.source)), s).toBeTruthy();
    }
    const ok = [
      'p.catch(() => { /* бейдж просто не покажется */ })',
      'p.catch(onError)',
      'p.catch(e => setError(e))',
    ];
    for (const s of ok) {
      expect(s.match(new RegExp(SWALLOW.source)) || s.match(new RegExp(AS_EMPTY.source)) || s.match(new RegExp(AS_EMPTY_VALUE.source)), s).toBeFalsy();
    }
  });

  it('нет `.catch(() => {})` без поясняющего комментария', () => {
    expect(offendersOf(SWALLOW), 'передайте ошибку в onError/LoadError или поясните деградацию комментарием внутри catch').toEqual([]);
  });

  it('нет `.catch(() => setX([] | {} | new Map() | 0 | null))`', () => {
    expect(offendersOf(AS_EMPTY), 'сбой нарисуется как «пусто» — заведите состояние ошибки и покажите LoadError').toEqual([]);
  });

  it('нет `.catch(() => [] | null | 0)` — подмены упавшего среза пустым значением', () => {
    expect(offendersOf(AS_EMPTY_VALUE), 'упавший срез станет пустым массивом и нулями — Promise.allSettled + settleSlices(), упавшее показать').toEqual([]);
  });
});
