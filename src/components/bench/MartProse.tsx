import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import mermaid from 'mermaid';
import elkLayouts from '@mermaid-js/layout-elk';

// The mart is a carrier of reasoning (v6.1): prose fields (narrative,
// rationale/mechanism/interpretation, long_description, conclusions) are
// Markdown. Render it properly — tables + mermaid — instead of a flat <p>.
// Same trust model as DocsPage: prose is authored by the experiment owner.

marked.setOptions({ gfm: true, breaks: false });

// DocsPage initializes mermaid on its module load, but it is lazy — initialize
// here too so prose diagrams work without ever visiting /docs (idempotent).
//
// Was a hand-tuned 'base' theme with our own themeVariables — kept missing
// individual sequence-diagram variables (alt/loop section fill, actor boxes,
// notes) one at a time as each surfaced as a fresh light-on-light bug. Using
// the built-in 'forest' theme instead means every diagram element's contrast
// is already a matched, tested set — not something we assemble field by
// field. Note: forest is a light-background theme (see the wrapper div in
// MermaidDiagram below, which matches it).
//
// layout: 'elk' as a GLOBAL default was tried and reverted — setting it at
// this top level applies to every diagram type, including ones (e.g.
// sequence) that don't support ELK layout, and it hung mermaid.render()
// silently (no thrown error, no console output, promise never settles) for
// every diagram on the page, not just the incompatible ones. The loader is
// still registered below so individual diagrams can opt in per-diagram via
// a %%{init: {"layout": "elk"}}%% frontmatter directive, which scopes the
// choice to diagram types that actually support it.
mermaid.registerLayoutLoaders(elkLayouts);
mermaid.initialize({
  startOnLoad: false,
  theme: 'forest',
  themeVariables: {
    fontFamily: 'monospace',
    fontSize: '13px',
  },
  securityLevel: 'loose',
});

const PROSE_CSS = `
.mart-prose { font-size: 13px; color: var(--t2); line-height: 1.55; }
.mart-prose h1, .mart-prose h2 { font-size: 1.1em; font-weight: 600; color: var(--t1); margin: 1em 0 .4em; }
.mart-prose h3, .mart-prose h4 { font-size: 1em; font-weight: 600; color: var(--t1); margin: .8em 0 .3em; }
.mart-prose p { margin: 0 0 .7em; }
.mart-prose p:last-child { margin-bottom: 0; }
.mart-prose ul, .mart-prose ol { margin: 0 0 .7em; padding-left: 1.5em; }
.mart-prose li { margin-bottom: .2em; }
.mart-prose strong { font-weight: 600; color: var(--t1); }
.mart-prose a { color: var(--acc); text-decoration: underline; text-underline-offset: 2px; }
.mart-prose blockquote { border-left: 3px solid var(--acc); margin: 0 0 .7em; padding: 2px 10px; background: var(--bg1); }
.mart-prose code { background: var(--bg2); border: 1px solid var(--bd); border-radius: 3px; padding: 0 4px; font-family: var(--mono); font-size: .9em; }
.mart-prose pre { background: var(--bg0); border: 1px solid var(--bd); border-radius: 6px; padding: 10px 12px; overflow-x: auto; margin: 0 0 .8em; }
.mart-prose pre code { background: none; border: none; padding: 0; }
.mart-prose table { border-collapse: collapse; margin: 0 0 .8em; font-size: .95em; }
.mart-prose th { background: var(--bg2); border: 1px solid var(--bd); padding: 4px 10px; text-align: left; font-weight: 600; color: var(--t1); }
.mart-prose td { border: 1px solid var(--bd); padding: 4px 10px; font-variant-numeric: tabular-nums; }
.mart-prose hr { border: none; border-top: 1px solid var(--bd); margin: 1em 0; }
`;

let mermaidSeq = 0;
let cssInjected = false;
function injectCssOnce(): void {
  if (cssInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.dataset.martProse = '1';
  style.textContent = PROSE_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

// Markdown split into renderable segments. Mermaid fences are pulled OUT of the
// dangerouslySetInnerHTML stream and rendered by React (see MermaidDiagram), so
// React owns the SVG node. The previous approach injected the SVG imperatively
// into React-owned innerHTML and lost a race: any re-commit (StrictMode, i18n
// language settle, sibling slice load) recreated the <pre> and clobbered the
// injection — nondeterministically leaving the raw ```mermaid fence visible.
type Segment = { kind: 'html'; html: string } | { kind: 'mermaid'; def: string };

const MERMAID_FENCE = /```mermaid[^\n]*\r?\n([\s\S]*?)```/g;

function toSegments(text: string): Segment[] {
  const segs: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MERMAID_FENCE.lastIndex = 0;
  while ((m = MERMAID_FENCE.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before.trim()) segs.push({ kind: 'html', html: marked.parse(before) as string });
    segs.push({ kind: 'mermaid', def: m[1].trim() });
    last = MERMAID_FENCE.lastIndex;
  }
  const tail = text.slice(last);
  if (tail.trim()) segs.push({ kind: 'html', html: marked.parse(tail) as string });
  return segs;
}

function MermaidDiagram({ def }: { def: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setErr(null);
    mermaid.render(`mart-mermaid-${mermaidSeq++}`, def)
      .then(({ svg }) => { if (active) setSvg(svg); })
      .catch(e => {
        console.warn('[mart-prose mermaid] render error:', e);
        if (active) setErr(String((e as Error)?.message ?? e));
      });
    return () => { active = false; };
  }, [def]);

  if (err) {
    return <div style={{ color: '#e06c75', fontSize: 12, fontFamily: 'var(--mono)', margin: '0 0 0.8em' }}>⚠ mermaid: {err}</div>;
  }
  if (svg) {
    // The diagram's colors (themeVariables above) assume a dark backdrop —
    // sequence-diagram arrows/labels have no background rect of their own,
    // so on a light-themed host page (e.g. the docs viewer) they inherit the
    // page background and become invisible. Force the dark backdrop here
    // instead of relying on the host page's theme. 'forest' is a light-
    // background theme (its own line/text colors assume a light backdrop) —
    // give it one explicitly rather than the dark background the old 'base'
    // theme needed, or its own arrows/labels wash out to low-contrast grey.
    return (
      <div
        style={{ margin: '0 0 0.8em', overflowX: 'auto', background: '#f4f4f4', borderRadius: 6, padding: 10 }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return <div style={{ minHeight: 24, margin: '0 0 0.8em' }} aria-hidden />;
}

export function MartProse({ text, style }: { text?: string | null; style?: React.CSSProperties }) {
  const segments = useMemo(() => (text ? toSegments(text) : []), [text]);

  useEffect(() => { injectCssOnce(); }, []);

  if (!text) return null;
  return (
    <div className="mart-prose" style={style}>
      {segments.map((seg, i) =>
        seg.kind === 'mermaid'
          ? <MermaidDiagram key={i} def={seg.def} />
          : <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />,
      )}
    </div>
  );
}
