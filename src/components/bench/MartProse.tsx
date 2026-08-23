import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from '../lore/markdown';
import mermaid from 'mermaid';
import elkLayouts from '@mermaid-js/layout-elk';
import { sanitizeMd, sanitizeSvg } from '../lore/sanitizeHtml';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

// The mart is a carrier of reasoning (v6.1): prose fields (narrative,
// rationale/mechanism/interpretation, long_description, conclusions) are
// Markdown. Render it properly — tables + mermaid — instead of a flat <p>.
// Same trust model as DocsPage: prose is authored by the experiment owner.

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
  // FIX-8: не давать mermaid рисовать свой error-SVG. При синтаксической ошибке
  // он ВСТАВЛЯЕТ в DOM картинку бомбы с надписью «Syntax error in text» во всю
  // ширину — она разворачивалась на пол-экрана и выталкивала текст ADR вниз
  // (поймано владельцем на ADR-MIDGARD-008). Промис при этом реджектится, и
  // наша собственная компактная плашка ниже уже показывает причину; бомба была
  // чистым дублем, занимающим в сотню раз больше места, чем сообщение.
  suppressErrorRendering: true,
  // SVG <text> labels, NOT HTML-in-foreignObject: our sanitizeSvg() (XSS pass)
  // strips the <div> content out of <foreignObject>, which left every node an
  // empty box. SVG text survives sanitisation and is coloured by themeVariables.
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  themeVariables: {
    fontFamily: 'monospace',
    fontSize: '13px',
    // The diagram always sits on a fixed light backdrop (--mermaid-bg #f4f4f4),
    // but 'forest' left node/edge label text at a near-invisible low-contrast
    // colour on the light-green nodes. Pin dark, high-contrast text so labels
    // stay readable regardless of the app's (dark/light) theme.
    primaryTextColor: '#14210a',
    secondaryTextColor: '#14210a',
    tertiaryTextColor: '#14210a',
    textColor: '#1c1c1c',
    nodeTextColor: '#14210a',
    lineColor: '#4c6138',
    edgeLabelBackground: '#f4f4f4',
    titleColor: '#1c1c1c',
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
/* Dark palette: mermaid draws SVG label <text> fill from the GLOBAL init and
   ignores a per-diagram text colour, so labels render dark. On the dark backdrop
   that is invisible — invert every label to light here (element selector, so it
   survives sanitizeSvg stripping class attributes). Edge-label backdrops stay
   dark (edgeLabelBackground), so light text on them reads. */
.mart-mermaid--dark svg text { fill: #e6e6e6 !important; }
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

// Markdown split into renderable segments. Diagram fences (mermaid, bpmn) are
// pulled OUT of the dangerouslySetInnerHTML stream and rendered by React (see
// MermaidDiagram/BpmnDiagram), so React owns the diagram's DOM node. The
// previous approach injected the SVG imperatively into React-owned innerHTML
// and lost a race: any re-commit (StrictMode, i18n language settle, sibling
// slice load) recreated the <pre> and clobbered the injection —
// nondeterministically leaving the raw ```mermaid fence visible.
type Segment =
  | { kind: 'html'; html: string }
  | { kind: 'mermaid'; def: string }
  | { kind: 'bpmn'; def: string };

// One regex for both fence languages (not two independent scans): scanning
// separately would let a ```bpmn block that happens to sit after the LAST
// mermaid match get silently absorbed into that match's "tail" HTML segment,
// since each regex only knows about its own language.
const DIAGRAM_FENCE = /```(mermaid|bpmn)[^\n]*\r?\n([\s\S]*?)```/g;

/** Экспортирована ТОЛЬКО ради теста: у репозитория нет jsdom/@testing-library
 * (см. LoreVpCanvas.tsx), поэтому проверяем логику разбора без монтирования
 * React — ровно тот случай, ради которого здесь уже вынесен `vpConnection`. */
export function toSegments(text: string): Segment[] {
  const segs: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  DIAGRAM_FENCE.lastIndex = 0;
  while ((m = DIAGRAM_FENCE.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before.trim()) segs.push({ kind: 'html', html: sanitizeMd(marked.parse(before) as string) });
    segs.push({ kind: m[1] as 'mermaid' | 'bpmn', def: m[2].trim() });
    last = DIAGRAM_FENCE.lastIndex;
  }
  const tail = text.slice(last);
  if (tail.trim()) segs.push({ kind: 'html', html: sanitizeMd(marked.parse(tail) as string) });
  return segs;
}

// Per-diagram palette presets — user-switchable (the toggle in the corner). Each
// becomes a single mermaid `%%{init}%%` directive (built by buildInit) prepended
// to the definition, overriding the global init for that one diagram. The `dark`
// preset relies on the injected `.mart-mermaid--dark svg text` CSS to invert its
// otherwise-dark labels to light (mermaid ignores a per-diagram text colour).
type DiagramTheme = { label: string; theme: string; bg: string; vars: Record<string, string>; dark?: boolean };
const BASE_VARS: Record<string, string> = { fontFamily: 'monospace', fontSize: '13px' };
const DIAGRAM_THEMES: DiagramTheme[] = [
  { label: 'Лес', theme: 'forest', bg: '#f4f7ee', vars: { ...BASE_VARS, primaryTextColor: '#14210a', secondaryTextColor: '#14210a', tertiaryTextColor: '#14210a', textColor: '#1c1c1c', lineColor: '#4c6138', edgeLabelBackground: '#f4f7ee' } },
  { label: 'Нейтр', theme: 'neutral', bg: '#f4f4f4', vars: { ...BASE_VARS, primaryTextColor: '#1c1c1c', secondaryTextColor: '#1c1c1c', tertiaryTextColor: '#1c1c1c', textColor: '#1c1c1c', lineColor: '#666', edgeLabelBackground: '#f4f4f4' } },
  { label: 'Синяя', theme: 'base', bg: '#eef4fc', vars: { ...BASE_VARS, primaryColor: '#cfe0ff', primaryBorderColor: '#3f6fb8', primaryTextColor: '#0e1c33', secondaryColor: '#e3ecff', tertiaryColor: '#eef3ff', textColor: '#1c1c1c', lineColor: '#3f6fb8', edgeLabelBackground: '#eef4fc' } },
  { label: 'Тёмная', theme: 'dark', bg: '#1e2229', dark: true, vars: { ...BASE_VARS, primaryColor: '#2d333b', primaryBorderColor: '#6b7684', primaryTextColor: '#e6e6e6', secondaryColor: '#343b44', tertiaryColor: '#2a2f37', textColor: '#e6e6e6', lineColor: '#9aa4b0', edgeLabelBackground: '#1e2229' } },
];

// Flowchart/graph diagrams get the ELK layout engine (registered above) for a
// cleaner routed layout. Other diagram types (sequence, class, state, …) don't
// support ELK — passing layout:elk to them hangs mermaid.render() silently — so
// only opt in when the definition is actually a flowchart/graph.
function isElkCompatible(def: string): boolean {
  const body = def
    .replace(/^\s*---[\s\S]*?---\s*/, '')        // YAML frontmatter block
    .replace(/^(\s*%%\{[\s\S]*?\}%%\s*)+/, '')   // leading %%{init}%% directives
    .replace(/^(\s*%%[^\n]*\r?\n)+/, '')          // leading %% line comments
    .trimStart();
  return /^(flowchart|graph)\b/.test(body);
}

// Build the single %%{init}%% directive for a palette, folding in layout:elk when
// the diagram supports it. One merged directive (not two) avoids relying on
// mermaid merging multiple directives.
function buildInit(t: DiagramTheme, elk: boolean): string {
  const cfg: Record<string, unknown> = { theme: t.theme, flowchart: { htmlLabels: false }, themeVariables: t.vars };
  if (elk) cfg.layout = 'elk';
  return `%%{init: ${JSON.stringify(cfg)}}%%`;
}

/** Экспортирована, чтобы продуктовый `Markdown` (shared.tsx) мог рендерить те
 * же диаграммы внутри своего собственного `.lore-md`-обёртки, а не только
 * внутри MartProse — тела UC/актора/боли и т.п. ходят через другой рендерер
 * markdown, но фенсы `mermaid`/`bpmn` в них те же самые. */
export function MermaidDiagram({ def }: { def: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [themeIdx, setThemeIdx] = useState(0);
  useEffect(() => {
    let active = true;
    setErr(null);
    mermaid.render(`mart-mermaid-${mermaidSeq++}`, `${buildInit(DIAGRAM_THEMES[themeIdx], isElkCompatible(def))}\n${def}`)
      .then(({ svg }) => { if (active) setSvg(svg); })
      .catch(e => {
        console.warn('[mart-prose mermaid] render error:', e);
        if (active) setErr(String((e as Error)?.message ?? e));
      });
    return () => { active = false; };
  }, [def, themeIdx]);

  if (err) {
    // Сообщения мало: оно говорит, ЧТО не так, но не показывает, где. Исходник
    // под <details> — автор правит текст, не открывая редактор; свёрнут, чтобы
    // сломанная диаграмма занимала место сломанной диаграммы, а не полстраницы.
    return (
      <div style={{ color: 'var(--dng)', fontSize: 'var(--fs-base)', fontFamily: 'var(--mono)',
                    margin: '0 0 0.8em', border: '1px solid var(--dng)', borderRadius: 4, padding: '4px 8px' }}>
        ⚠ mermaid: {err}
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--t3)' }}>исходник диаграммы</summary>
          <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', color: 'var(--t2)' }}>{def}</pre>
        </details>
      </div>
    );
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
      <div style={{ position: 'relative', margin: '0 0 0.8em' }}>
        <button
          type="button"
          onClick={() => setThemeIdx(i => (i + 1) % DIAGRAM_THEMES.length)}
          title="Сменить палитру диаграммы"
          style={{
            position: 'absolute', top: 6, right: 8, zIndex: 1, cursor: 'pointer',
            fontSize: 'var(--fs-2xs)', padding: '2px 8px', borderRadius: 4,
            border: '1px solid var(--bd)', background: 'var(--bg1)', color: 'var(--t2)',
            fontFamily: 'var(--mono)', opacity: 0.85,
          }}
        >🎨 {DIAGRAM_THEMES[themeIdx].label}</button>
        {/* color: with htmlLabels:false labels are SVG <text> (coloured by
            themeVariables); the mart-mermaid--dark class inverts them to light
            for the dark palette (see PROSE_CSS). */}
        <div
          className={`mart-mermaid${DIAGRAM_THEMES[themeIdx].dark ? ' mart-mermaid--dark' : ''}`}
          style={{ overflowX: 'auto', background: DIAGRAM_THEMES[themeIdx].bg, borderRadius: 6, padding: 10, color: DIAGRAM_THEMES[themeIdx].dark ? '#e6e6e6' : '#1c1c1c' }}
          dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }}
        />
      </div>
    );
  }
  return <div style={{ minHeight: 24, margin: '0 0 0.8em' }} aria-hidden />;
}

/**
 * ```bpmn — BPMN 2.0 XML, рендерится bpmn-js (NavigatedViewer: пан/зум, без
 * редактирования — MartProse только читает). Тот же trust model, что у
 * mermaid выше: тело авторизует владелец записи.
 *
 * Отличия от MermaidDiagram, из-за которых компонент не идентичен:
 *  - `mermaid.render()` возвращает СТРОКУ SVG — мы её санитизируем и вставляем
 *    сами. `viewer.importXML()` рисует ПРЯМО в переданный контейнер — своей
 *    санитизации нет и быть не может, отсюда тот же trust model, что и для
 *    остального тела (авторство доверенное, как у markdown/HTML-сегментов).
 *  - Контейнеру нужна ЯВНАЯ высота ДО importXML: canvas bpmn-js схлопывается
 *    в 0 у родителя с height:auto (в отличие от mermaid, где SVG сам задаёт
 *    себе размер по содержимому).
 *  - Viewer — объект с состоянием, а не чистая функция: обязателен
 *    `destroy()` при размонтировании/смене def, иначе утечка DOM и
 *    обработчиков (mermaid ничего подобного не держит).
 */
/** Экспортирована по той же причине, что и {@link MermaidDiagram}. */
export function BpmnDiagram({ def }: { def: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active = true;
    setErr(null);
    const viewer = new NavigatedViewer({ container: host });
    viewer.importXML(def)
      .then(() => {
        if (!active) return;
        // fit-viewport ПОСЛЕ импорта: до него canvas не знает размеров схемы.
        // `.get()` без явного ServiceMap типизирован как unknown — bpmn-js не
        // экспортирует типы своих внутренних сервисов (canvas — из diagram-js,
        // не из bpmn-js), поэтому явный каст, а не борьба с generic-параметром.
        (viewer.get('canvas') as { zoom: (mode: string) => void }).zoom('fit-viewport');
      })
      .catch((e: unknown) => {
        console.warn('[mart-prose bpmn] render error:', e);
        if (active) setErr(String((e as Error)?.message ?? e));
      });
    return () => {
      active = false;
      viewer.destroy();
    };
  }, [def]);

  if (err) {
    return <div style={{ color: 'var(--dng)', fontSize: 'var(--fs-base)', fontFamily: 'var(--mono)', margin: '0 0 0.8em' }}>⚠ bpmn: {err}</div>;
  }
  return (
    <div
      // bpmn.io рисует тёмные фигуры/текст на прозрачном фоне — как и у
      // mermaid, задаём светлый фон явно, а не полагаемся на тему хоста:
      // на тёмной теме приложения тёмные линии стали бы нечитаемы.
      ref={hostRef}
      className="mart-bpmn"
      style={{ height: 420, background: '#fbfbfb', border: '1px solid var(--bd)', borderRadius: 6, margin: '0 0 0.8em' }}
    />
  );
}

export function MartProse({ text, style }: { text?: string | null; style?: React.CSSProperties }) {
  const segments = useMemo(() => (text ? toSegments(text) : []), [text]);

  useEffect(() => { injectCssOnce(); }, []);

  if (!text) return null;
  return (
    <div className="mart-prose" style={style}>
      {segments.map((seg, i) => {
        if (seg.kind === 'mermaid') return <MermaidDiagram key={i} def={seg.def} />;
        if (seg.kind === 'bpmn') return <BpmnDiagram key={i} def={seg.def} />;
        return <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />;
      })}
    </div>
  );
}
