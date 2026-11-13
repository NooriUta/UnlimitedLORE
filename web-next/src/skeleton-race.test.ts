// SPRINT_UXR_S11_TEST_OPT/S11-SECRET-ROTATION-RACE — сторож гонки
// «findBy контейнера → синхронный getBy содержимого».
//
// develop eb991e41 упал на CI (web-next, push): secretRotation.test.tsx ждал
// карточку `adm-oldsecret`, а она рисуется СРАЗУ — со скелетоном внутри; строку
// срока тест искал синхронным getBy, и итог зависел от того, успела ли заглушка
// ответить. Тот же коммит в PR прошёл. Тот же шаблон нашёлся ещё в двух местах
// (actions.test.tsx — панель пачки, preflight.test.tsx — секция preflight).
//
// Правило (а не частный фикс): если контейнер может стоять со скелетоном —
// то есть его data-testid встречается в исходнике, где рисуется <Skeleton —
// содержимое внутри него после findBy-контейнера ищется только асинхронно:
// `await within(box).findBy…`. Синхронный getBy/queryBy там проходит или падает
// по таймингу, а queryBy(...).toBeNull() ещё и проходит ложно.
//
// Исключение — комментарий `skeleton-race: ok — <почему>` на строке чтения.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webNext = resolve(here, '..');
const repo = resolve(webNext, '..');
const ROOTS = [resolve(webNext, 'src'), resolve(repo, 'kit', 'src')];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const files = ROOTS.flatMap((r) => walk(r));
const isTest = (f: string) => /\.test\.tsx?$/.test(f);

const indent = (l: string) => l.length - l.trimStart().length;

/**
 * data-testid элементов, которые ОБЪЕМЛЮТ скелетон загрузки в JSX: контейнер
 * уже на экране, а содержимого ещё нет. Скелетон — строка с `<Skeleton` или
 * `{имя}`, где `имя = <Skeleton…` присвоено в том же файле (AuthPreflight:
 * `body = <Skeleton…/>` → `<section data-testid="adm-pf">{body}`). Предки ищутся
 * по отступам вверх до `return (`.
 */
export function skeletonContainers(sources: Array<{ text: string }>): Set<string> {
  const ids = new Set<string>();
  for (const { text } of sources) {
    if (!text.includes('<Skeleton')) continue;
    const lines = text.split('\n');
    const skelVars = new Set([...text.matchAll(/(\w+) = <Skeleton/g)].map((m) => m[1]));
    const isSkel = (l: string) =>
      l.includes('<Skeleton') && !/^\s*(?:const |let |if |else )?\w+ = <Skeleton/.test(l)
        || [...skelVars].some((v) => l.trim() === `{${v}}`);
    for (let i = 0; i < lines.length; i++) {
      if (!isSkel(lines[i])) continue;
      let cur = indent(lines[i]);
      for (let j = i - 1; j >= 0; j--) {
        const l = lines[j];
        if (/\breturn \(/.test(l)) break;
        if (!l.trim() || indent(l) >= cur || !l.trimStart().startsWith('<')) continue;
        cur = indent(l);
        const m = l.match(/data-testid="([^"`${}]+)"/);
        if (m) ids.add(m[1]);
      }
    }
  }
  return ids;
}

const FIND_CONTAINER = /const (\w+) = await screen\.findBy(?:All)?TestId\('([^']+)'\)/;

/** Строки, где после findBy-контейнера со скелетоном содержимое читается синхронно. */
export function raceReads(text: string, containers: Set<string>): number[] {
  const lines = text.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FIND_CONTAINER);
    if (!m || !containers.has(m[2])) continue;
    const v = m[1];
    const awaited = new RegExp(`await within\\(${v}\\)`);
    const sync = new RegExp(`within\\(${v}\\)\\.(?:get|query)(?:All)?By`);
    // Смотрим чтения до первого явного ожидания содержимого — `await within(box).findBy…`
    // или `await waitFor(…)`: после него данные уже пришли, и синхронный getBy честен.
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      if (awaited.test(lines[j]) || /await waitFor\(/.test(lines[j])) break;
      // внутри waitFor(...) чтение повторяется до успеха — это и есть ожидание
      if (sync.test(lines[j]) && !/waitFor\(/.test(lines[j])) {
        if (!/skeleton-race: ok/.test(lines[j])) hits.push(j + 1);
        break;
      }
    }
  }
  return hits;
}

describe('S11-SECRET-ROTATION-RACE · сторож «findBy контейнера → синхронный getBy содержимого»', () => {
  it('положительный контроль: прежняя форма secretRotation ловится, исправленная — нет', () => {
    const containers = skeletonContainers([
      { text: [
        '  return (',
        '    <div className="adm-card" data-testid="adm-oldsecret">',
        '      <span data-testid="adm-oldsecret-title">t</span>',
        '      {state === null && <Skeleton lines={2} />}',
        '    </div>',
      ].join('\n') },
      { text: [
        '  if (loading) body = <Skeleton lines={2} />;',
        '  return (',
        '    <section data-testid="adm-pf">',
        '      {body}',
        '    </section>',
      ].join('\n') },
    ]);
    // предки скелетона — да; соседний элемент без скелетона внутри — нет
    expect([...containers].sort()).toEqual(['adm-oldsecret', 'adm-pf']);
    const before = [
      "    const sw = await screen.findByTestId('adm-oldsecret');",
      "    expect(within(sw).getByTestId('adm-oldsecret-expires').textContent).toContain('2026-11-13');",
    ].join('\n');
    const after = [
      "    const sw = await screen.findByTestId('adm-oldsecret');",
      "    expect((await within(sw).findByTestId('adm-oldsecret-expires')).textContent).toContain('2026-11-13');",
    ].join('\n');
    expect(raceReads(before, containers)).toEqual([2]);
    expect(raceReads(after, containers)).toEqual([]);
    // queryBy(...).toBeNull() по скелетону проходит ЛОЖНО — тоже гонка
    expect(raceReads(before.replace('getByTestId', 'queryByTestId'), containers)).toEqual([2]);
    // контейнер без скелетона в исходнике — не наш случай
    expect(raceReads(before, new Set())).toEqual([]);
  });

  it('контейнеры со скелетоном найдены в исходниках (сторож не слепой)', () => {
    const ids = skeletonContainers(files.filter((f) => /\.tsx$/.test(f) && !isTest(f)).map((f) => ({ text: read(f) })));
    // три места, на которых правило выведено, обязаны быть в наборе
    for (const id of ['adm-oldsecret', 'adm-log-batch-panel', 'adm-pf']) expect(ids.has(id), id).toBe(true);
  });

  it('ни один тест web-next и kit не читает синхронно внутри контейнера со скелетоном', () => {
    const ids = skeletonContainers(files.filter((f) => /\.tsx$/.test(f) && !isTest(f)).map((f) => ({ text: read(f) })));
    const self = fileURLToPath(import.meta.url);
    const offenders = files
      .filter((f) => isTest(f) && resolve(f) !== resolve(self))
      .flatMap((f) => raceReads(read(f), ids).map((line) => `${relative(repo, f).replace(/\\/g, '/')}:${line}`));
    expect(offenders, 'ждать содержимое: `await within(box).findBy…` (или пометка `skeleton-race: ok — почему`)').toEqual([]);
  });
});
