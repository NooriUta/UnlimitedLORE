// Единственная точка настройки marked в kit (как src/components/lore/markdown.ts
// в v1): все читающие рендеры MD берут `marked` отсюда, а не из пакета напрямую.
import { marked } from 'marked';
import { markedMath } from './markdownMath';
import { markedWiki } from './markdownWiki';

marked.setOptions({ gfm: true, breaks: false });
// Формулы LaTeX ($…$, $$…$$, ```math) — KaTeX, как в v1 (S0-09); K-04.
marked.use(markedMath());
// Вики-ссылки [[ID]] / [[тип:ID]] — рамкой, без скобок (владелица 08.11).
marked.use(markedWiki());

export { marked };
