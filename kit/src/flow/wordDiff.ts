// Пословный дифф (SPRINT_UXR_S10_SEIDR_KIT/K-12).
//
// По этому диффу человек решает, активировать версию контента или нет, поэтому
// функция чистая и проверяемая, а не «приблизительно подсвечено».
//
// Два свойства, которые закреплены тестами и важнее красоты вывода:
//
//  1. **Ничего не теряется.** Склейка кусков «было» (same + del) обязана дать
//     ровно исходный текст, склейка «стало» (same + add) — ровно новый. Дифф,
//     который съел слово, хуже отсутствия диффа.
//  2. **Длинный текст не вешает экран.** Точный дифф — это таблица
//     |было| × |стало|; на тысяче слов это миллион ячеек. Поэтому выше порога
//     возвращается ГРУБЫЙ дифф («всё убрано, всё добавлено») и флаг
//     `exact: false` — чтобы экран сказал об этом словами, а не притворялся.
//
// Пробелы и переводы строк сохраняются: текст читают глазами, и склеенные в
// одну строку абзацы нечитаемы.

export type WordChunkKind = 'same' | 'add' | 'del';
export interface WordChunk { kind: WordChunkKind; text: string }
export interface WordDiffResult {
  chunks: WordChunk[];
  /** false — дифф грубый (текст длиннее порога); это надо сказать человеку. */
  exact: boolean;
}

export interface WordDiffOptions {
  /** Сколько слов с каждой стороны ещё считаем точно. По умолчанию 400. */
  limit?: number;
}

/** Слова вместе с разделителями: пробелы остаются частью вывода. */
function tokens(text: string): string[] {
  if (!text) return [];
  return text.split(/(\s+)/).filter(t => t !== '');
}

function push(out: WordChunk[], kind: WordChunkKind, text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push({ kind, text });
}

export function wordDiff(from: string, to: string, opts: WordDiffOptions = {}): WordDiffResult {
  const limit = opts.limit ?? 400;
  const a = tokens(from);
  const b = tokens(to);

  if (!a.length && !b.length) return { chunks: [], exact: true };
  if (!a.length) return { chunks: [{ kind: 'add', text: to }], exact: true };
  if (!b.length) return { chunks: [{ kind: 'del', text: from }], exact: true };

  if (a.length > limit || b.length > limit) {
    return { chunks: [{ kind: 'del', text: from }, { kind: 'add', text: to }], exact: false };
  }

  // Наибольшая общая подпоследовательность слов: таблица длин.
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: WordChunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push(out, 'same', a[i]); i++; j++; continue; }
    // При равенстве вариантов выбираем удаление: порядок «убрали, потом
    // добавили» одинаков для всех входов, то есть результат детерминирован.
    if (dp[i + 1][j] >= dp[i][j + 1]) { push(out, 'del', a[i]); i++; }
    else { push(out, 'add', b[j]); j++; }
  }
  while (i < n) { push(out, 'del', a[i]); i++; }
  while (j < m) { push(out, 'add', b[j]); j++; }

  return { chunks: out, exact: true };
}
