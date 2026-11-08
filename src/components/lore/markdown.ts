import { marked } from 'marked';
import { markedMath } from './markdownMath';

// T14: single source of truth for marked's global config. Was set
// independently in MartProse.tsx and BragiSkinPreview.tsx (both {gfm: true,
// breaks: false}, so no behavioral drift so far) plus LoreSprintDetail.tsx
// silently relying on whichever of those two ran first at module load — a
// footgun waiting for one of them to diverge. Every read-only markdown
// renderer in the app imports `marked` from here instead of 'marked'
// directly, so there is exactly one place this is configured.
marked.setOptions({ gfm: true, breaks: false });
// S0-09: формулы LaTeX ($…$, $$…$$, ```math) — KaTeX, см. markdownMath.ts.
marked.use(markedMath());

export { marked };

/**
 * AH-10: короткое превью markdown для строк списков (описание релиза).
 * Раньше превью было `md.slice(0, 110)` сырой строкой — с «##»/«**» на экране
 * и разрывом посреди слова или разметки. Теперь режем по границе строки
 * (а одну длинную строку — по слову) и рендерим результат MartProse.
 */
export function mdExcerpt(md: string | null | undefined, max: number): string {
  const text = (md ?? '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const lines = text.split('\n');
  let acc = '';
  for (const line of lines) {
    const next = acc ? `${acc}\n${line}` : line;
    if (next.length > max) break;
    acc = next;
  }
  acc = acc.trimEnd();
  if (acc) return `${acc} …`;
  const head = text.slice(0, max);
  const cut = head.lastIndexOf(' ');
  return `${(cut > 0 ? head.slice(0, cut) : head).trimEnd()} …`;
}
