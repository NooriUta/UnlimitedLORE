// Единственная точка настройки marked в kit (как src/components/lore/markdown.ts
// в v1): все читающие рендеры MD берут `marked` отсюда, а не из пакета напрямую.
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

export { marked };
