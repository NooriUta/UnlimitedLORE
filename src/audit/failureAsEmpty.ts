/**
 * SPRINT_UXR_S0_SAFETY/S0-08 · инвентаризация мест, где сбой загрузки выглядит как «пусто».
 *
 * Чистые функции над картой «путь → исходник», без файловой системы — вызываются
 * из теста (import.meta.glob) и дают одинаковый результат на одном и том же коде,
 * поэтому замер «после» (SPRINT_UXR_S8_SWITCH/S8-03) сравним с замером «до».
 *
 * Две формы, которые сторож AH-07 (`styles/no-silent-catch.test.ts`) не видит:
 *
 * - `toast-only-catch` — загрузка (`fetch*`) падает в `.catch`, который только
 *   отдаёт ошибку в `onError` (тост) и снимает спиннер. Для ошибок не уровня
 *   страницы (403, 404, 5xx, таймаут) своего состояния ошибки у блока нет: тост
 *   исчезает, а тело блока рисует пустую выдачу — «ADR не найден», «Решений пока нет».
 * - `useslice-error-unread` — `useSlice` возвращает `error`, но вызывающий его не
 *   читает: на сбое в руках только `rows = []`.
 */

export type FailureAsEmptyRule = 'toast-only-catch' | 'useslice-error-unread';

export interface FailureAsEmptyFinding {
  file: string;
  line: number;
  rule: FailureAsEmptyRule;
}

export interface CatchHandler {
  /** Номер строки (с 1), где стоит `.catch(`. */
  line: number;
  /** Смещение `.catch(` в исходнике. */
  index: number;
  /** Текст между скобками `.catch( … )`. */
  body: string;
}

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length;

/** Все `.catch( … )` с телом, вырезанным по балансу круглых скобок. */
export function catchHandlers(src: string): CatchHandler[] {
  const out: CatchHandler[] = [];
  const re = /\.catch\(/g;
  for (const m of src.matchAll(re)) {
    const start = m.index! + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    if (depth !== 0) continue;
    out.push({ line: lineOf(src, m.index!), index: m.index!, body: src.slice(start, i - 1) });
  }
  return out;
}

/** Обработчик отдаёт ошибку наверх (тост / страница). */
const REPORTS_UP = /\b(?:on|handle)\w*Error\s*\(/;
/** У блока есть своё состояние ошибки — сбой будет виден в теле. */
const OWN_ERROR_STATE = /\bset\w*(?:Err|Error|Fail|Failed|Failure)\w*\s*\(|\bthrow\b|LoadError/;
/** Ближайший к `.catch` вызов API: загрузка или запись. */
const API_CALL = /\b(fetch\w*|post\w*|put\w*|patch\w*|delete\w*|save\w*|create\w*)\s*(?:<[^()]*?>)?\s*\(/g;
const LOOKBACK = 2500;

function isLoadChain(src: string, catchIndex: number): boolean {
  const win = src.slice(Math.max(0, catchIndex - LOOKBACK), catchIndex);
  let last: string | null = null;
  for (const m of win.matchAll(API_CALL)) last = m[1];
  return last !== null && last.startsWith('fetch');
}

function toastOnlyCatches(file: string, src: string): FailureAsEmptyFinding[] {
  return catchHandlers(src)
    .filter(h => REPORTS_UP.test(h.body) && !OWN_ERROR_STATE.test(h.body) && isLoadChain(src, h.index))
    .map(h => ({ file, line: h.line, rule: 'toast-only-catch' as const }));
}

function unreadUseSliceErrors(file: string, src: string): FailureAsEmptyFinding[] {
  const out: FailureAsEmptyFinding[] = [];
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*useSlice\b/g)) {
    if (!/\berror\b/.test(m[1])) out.push({ file, line: lineOf(src, m.index!), rule: 'useslice-error-unread' });
  }
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useSlice\b/g)) {
    if (!new RegExp(String.raw`\b${m[1]}\.error\b|\{[^}]*\berror\b[^}]*\}\s*=\s*${m[1]}\b`).test(src)) {
      out.push({ file, line: lineOf(src, m.index!), rule: 'useslice-error-unread' });
    }
  }
  return out;
}

/** Все места «сбой как пусто», отсортированные по файлу и строке. */
export function scanFailureAsEmpty(sources: Record<string, string>): FailureAsEmptyFinding[] {
  const out: FailureAsEmptyFinding[] = [];
  for (const [file, src] of Object.entries(sources)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    out.push(...toastOnlyCatches(file, src), ...unreadUseSliceErrors(file, src));
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Знаменатель доли «сбой как пусто»: все места, где экран грузит данные и
 * обязан как-то обойтись со сбоем, — `.catch` на цепочке `fetch*` плюс вызовы
 * `useSlice`. Запись (`post*`/`save*`…) не считается: там сбой не выглядит пустотой.
 */
export function countLoadSites(sources: Record<string, string>): number {
  let n = 0;
  for (const [file, src] of Object.entries(sources)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    n += catchHandlers(src).filter(h => isLoadChain(src, h.index)).length;
    n += [...src.matchAll(/=\s*useSlice\b/g)].length;
  }
  return n;
}

export interface FailureAsEmptySummary {
  sites: number;
  files: number;
  /** Все места загрузки (знаменатель), см. countLoadSites. */
  loadSites: number;
  /** sites / loadSites, округлено до 0.001. */
  share: number;
  byRule: Record<FailureAsEmptyRule, number>;
  sitesList: string[];
}

export function summarize(found: FailureAsEmptyFinding[], loadSites: number): FailureAsEmptySummary {
  const byRule: Record<FailureAsEmptyRule, number> = { 'toast-only-catch': 0, 'useslice-error-unread': 0 };
  for (const f of found) byRule[f.rule]++;
  return {
    sites: found.length,
    files: new Set(found.map(f => f.file)).size,
    loadSites,
    share: loadSites ? Math.round((found.length / loadSites) * 1000) / 1000 : 0,
    byRule,
    sitesList: found.map(f => `${f.file}:${f.line} ${f.rule}`),
  };
}
