// Слияние markdown по блокам и построчный дифф спорных
// (SPRINT_UXR_S5_RECORD_TASKS/S5-08).
//
// Когда сохранение отказало 409-м (запись изменили, пока её правили), у нас
// три текста поля: БАЗА — то, что человек открыл на правку, МОЁ — то, что он
// набрал, ИХ — то, что лежит в записи сейчас. Сливаем трёхсторонне, но не по
// строкам, а по БЛОКАМ верхнего уровня (абзац, список, заголовок, огороженный
// код, $$-формула): блок поменяла одна сторона — берём её версию; обе
// одинаково — берём любую; обе по-разному — это СПОР, и только по нему
// человеку показывается построчный дифф.
//
// Почему блоки, а не строки: построчное слияние склеивает правки внутри
// одного абзаца в текст, который никто не писал. Блок — единица смысла, и
// решать по нему человеку проще: «оставить мой абзац или взять их».
//
// Чистые функции без DOM — их проверяют тесты (blockMerge.test.ts).

/** Блоки верхнего уровня; пустые строки внутри огороженного кода и $$ не режут. */
export function splitBlocks(md: string): string[] {
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  const flush = () => { if (cur.length) blocks.push(cur.join('\n')); cur = []; };
  for (const line of lines) {
    const trimmed = line.trim();
    if (fence) {
      cur.push(line);
      if (fence === '$$' ? trimmed === '$$' : trimmed.startsWith(fence) && trimmed.replace(/[`~]/g, '') === '') fence = null;
      continue;
    }
    const open = /^(`{3,}|~{3,})/.exec(trimmed);
    if (open) { fence = open[1]; cur.push(line); continue; }
    if (trimmed === '$$') { fence = '$$'; cur.push(line); continue; }
    if (trimmed === '') { flush(); continue; }
    cur.push(line);
  }
  flush();
  return blocks;
}

export type MergeChunk =
  | { kind: 'ok'; text: string }
  | { kind: 'conflict'; base: string; mine: string; theirs: string };

export interface BlockMergeResult {
  chunks: MergeChunk[];
  /** Сколько спорных блоков. 0 — слилось само. */
  conflicts: number;
  /** Слитый текст; null — есть спор, и решать его человеку. */
  text: string | null;
}

/** Пары совпавших индексов (наибольшая общая подпоследовательность). */
function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
const join = (xs: readonly string[]) => xs.join('\n\n');

function resolveChunk(base: string[], mine: string[], theirs: string[], out: MergeChunk[]): void {
  if (!base.length && !mine.length && !theirs.length) return;
  const take = (xs: string[]) => { for (const x of xs) out.push({ kind: 'ok', text: x }); };
  if (same(mine, base)) return take(theirs);
  if (same(theirs, base)) return take(mine);
  if (same(mine, theirs)) return take(mine);
  // Блоки остались на своих местах и правлены на месте (числа равны) — решаем
  // по каждому отдельно: иначе две правки соседних абзацев стали бы одним
  // общим спором, хотя спорит только один из них.
  if (base.length > 1 && base.length === mine.length && base.length === theirs.length) {
    for (let k = 0; k < base.length; k++) resolveChunk([base[k]], [mine[k]], [theirs[k]], out);
    return;
  }
  out.push({ kind: 'conflict', base: join(base), mine: join(mine), theirs: join(theirs) });
}

/** Трёхстороннее слияние по блокам: база, моё, их. */
export function mergeBlocks(base: string, mine: string, theirs: string): BlockMergeResult {
  // Короткие пути — точные: текст возвращается дословно, без нормализации пустых строк.
  if (mine === theirs || theirs === base) return { chunks: [{ kind: 'ok', text: mine }], conflicts: 0, text: mine };
  if (mine === base) return { chunks: [{ kind: 'ok', text: theirs }], conflicts: 0, text: theirs };
  const b = splitBlocks(base), m = splitBlocks(mine), t = splitBlocks(theirs);
  const toMine = new Map(lcsPairs(b, m));
  const toTheirs = new Map(lcsPairs(b, t));
  const chunks: MergeChunk[] = [];
  let bi = 0, mi = 0, ti = 0;
  for (let i = 0; i < b.length; i++) {
    const mj = toMine.get(i), tj = toTheirs.get(i);
    if (mj === undefined || tj === undefined) continue;
    // Блок базы не тронут ни одной стороной — опора; всё между опорами решается куском.
    resolveChunk(b.slice(bi, i), m.slice(mi, mj), t.slice(ti, tj), chunks);
    chunks.push({ kind: 'ok', text: b[i] });
    bi = i + 1; mi = mj + 1; ti = tj + 1;
  }
  resolveChunk(b.slice(bi), m.slice(mi), t.slice(ti), chunks);
  const conflicts = chunks.filter(c => c.kind === 'conflict').length;
  return { chunks, conflicts, text: conflicts ? null : assemble(chunks.map(c => (c.kind === 'ok' ? c.text : ''))) };
}

function assemble(parts: string[]): string {
  return parts.filter(p => p !== '').join('\n\n');
}

/** Выбор по спорному блоку: индекс спора (по порядку) → чью версию взять. */
export type MergePicks = Readonly<Record<number, 'mine' | 'theirs'>>;

/** Собрать текст по выбору; не выбран хоть один спор — null (решать за человека нельзя). */
export function resolveMerge(chunks: readonly MergeChunk[], picks: MergePicks): string | null {
  const parts: string[] = [];
  let k = 0;
  for (const c of chunks) {
    if (c.kind === 'ok') { parts.push(c.text); continue; }
    const pick = picks[k++];
    if (!pick) return null;
    parts.push(pick === 'mine' ? c.mine : c.theirs);
  }
  return assemble(parts);
}

export type LineOp = { op: 'same' | 'del' | 'add'; line: string };

/**
 * Построчный дифф «было → стало». Склейка same+del — ровно «было», same+add —
 * ровно «стало». Длиннее порога — грубый дифф (всё убрано, всё добавлено):
 * таблица LCS квадратична, и экран не должен вешаться.
 */
export function lineDiff(from: string, to: string, limit = 2000): LineOp[] {
  const a = from === '' ? [] : from.split('\n');
  const b = to === '' ? [] : to.split('\n');
  if (a.length > limit || b.length > limit) {
    return [...a.map(line => ({ op: 'del' as const, line })), ...b.map(line => ({ op: 'add' as const, line }))];
  }
  const pairs = lcsPairs(a, b);
  const out: LineOp[] = [];
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    while (i < pi) out.push({ op: 'del', line: a[i++] });
    while (j < pj) out.push({ op: 'add', line: b[j++] });
    if (pi < a.length) { out.push({ op: 'same', line: a[pi] }); i++; j++; }
  }
  return out;
}

/**
 * Отказ сохранения со спором: запись изменили, пока её правили, и слить сами
 * не смогли. Бросает вызывающий (он знает API и перечитал запись), ловит поле
 * правки — и показывает дифф только спорных блоков.
 */
export class MdMergeConflict extends Error {
  constructor(
    readonly chunks: MergeChunk[],
    /** Кто правил запись (если сервер назвал). */
    readonly updatedBy: string | null = null,
  ) {
    super('запись изменили, пока вы её правили: есть спорные блоки');
    this.name = 'MdMergeConflict';
  }
}

/** Поле правки узнаёт спор и по классу, и по форме (два экземпляра модуля). */
export function isMdMergeConflict(e: unknown): e is MdMergeConflict {
  return e instanceof MdMergeConflict
    || (!!e && typeof e === 'object' && (e as { name?: unknown }).name === 'MdMergeConflict'
      && Array.isArray((e as { chunks?: unknown }).chunks));
}
