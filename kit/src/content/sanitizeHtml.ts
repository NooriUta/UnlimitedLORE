// Общий санитайзер HTML Seiðr-kit (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00d).
// Копия v1 src/components/lore/sanitizeHtml.ts (v1 заморожен,
// D-2026-UXR-V2-FOLDER-V1-FROZEN — src/ не правим, а образ v2 его не видит).
// Каждый путь markdown→HTML, который кончается innerHTML, идёт через него:
// срезает <script>, on*-обработчики и javascript:/data:-ссылки, оставляя всё,
// что выдаёт marked (заголовки, списки, GFM-таблицы, чек-листы, ссылки, код).
import DOMPurify from 'dompurify';

export function sanitizeMd(html: string): string {
  if (!html) return html;
  return DOMPurify.sanitize(html);
}

/** SVG-профиль для диаграмм mermaid: фигуры живут, скрипты и обработчики — нет. */
export function sanitizeSvg(svg: string): string {
  if (!svg) return svg;
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'],
  });
}
