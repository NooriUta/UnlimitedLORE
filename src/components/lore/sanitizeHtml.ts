import DOMPurify from 'dompurify';

// Shared HTML sanitizer for every markdown→HTML path that ends in
// dangerouslySetInnerHTML / element.innerHTML (SPRINT_LORE_UX_OPTIMIZATION T10,
// finding S-1..S-5). Prose is authored by trusted owners, but we sanitize
// defensively: strips <script>, inline event handlers (onerror/onload/…) and
// javascript:/data: script URLs while keeping everything `marked` emits —
// headings, lists, GFM tables, task-list checkboxes, links, images, code.
export function sanitizeMd(html: string): string {
  if (!html) return html;
  return DOMPurify.sanitize(html);
}

// SVG variant for mermaid-rendered diagrams injected as innerHTML (S-4). Uses
// the SVG profile so the diagram markup survives while scripts / event handlers
// are stripped; foreignObject (mermaid's HTML labels) is kept.
export function sanitizeSvg(svg: string): string {
  if (!svg) return svg;
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'],
  });
}
