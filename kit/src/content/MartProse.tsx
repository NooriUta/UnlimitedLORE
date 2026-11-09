// MartProse (S4-00d) — чтение markdown в kit: GFM-таблицы, чек-листы, код,
// диаграммы ```mermaid и ```bpmn. Копия v1 src/components/bench/MartProse.tsx
// (v1 заморожен, D-2026-UXR-V2-FOLDER-V1-FROZEN), отличия — только то, чего
// требует kit:
//  - стиль — классы sk-prose* в seidr.css, а не CSS, вставляемый из JS;
//  - палитра диаграмм — из токенов (--diagram-* «бумага» или токены темы
//    приложения), а не hex в коде: STYLE-01 v2 запрещает сырой цвет вне
//    seidr.css. Переключатель палитры сохранён (бумага ↔ тема);
//  - подписи — из локалей kit.
// Доверие то же, что в v1: тело пишет владелец записи; HTML-сегменты и SVG всё
// равно проходят санитайзер.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import mermaid from 'mermaid';
import elkLayouts from '@mermaid-js/layout-elk';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import { marked } from './markdown';
import { sanitizeMd, sanitizeSvg } from './sanitizeHtml';
import { kitT } from '../i18n';
import { useKitLang } from '../i18n/lang';

// ELK-раскладка — только по явной просьбе диаграммы (см. buildInit): глобальный
// layout:elk вешал mermaid.render() на типах, которые его не поддерживают (v1).
mermaid.registerLayoutLoaders(elkLayouts);
mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  // Не рисовать свою «бомбу» на всю ширину при синтаксической ошибке (v1 FIX-8):
  // компактная плашка ниже показывает причину сама.
  suppressErrorRendering: true,
  // Подписи SVG-<text>, а не HTML в foreignObject: санитайзер срезает его
  // содержимое, и узлы оставались пустыми коробками (v1).
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  securityLevel: 'loose',
});

let mermaidSeq = 0;

export type ProseSegment =
  | { kind: 'html'; html: string }
  | { kind: 'mermaid'; def: string }
  | { kind: 'bpmn'; def: string };

// Одна регулярка на оба языка: два независимых прохода дали бы bpmn после
// последнего mermaid утонуть в его «хвостовом» HTML-сегменте (v1).
const DIAGRAM_FENCE = /```(mermaid|bpmn)[^\n]*\r?\n([\s\S]*?)```/g;

/** Имена флажков чек-листа (локализует вызывающий). */
export interface TaskLabels { done: string; todo: string }
const DEFAULT_TASK_LABELS: TaskLabels = { done: 'done', todo: 'not done' };

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Флажки GFM-чек-листа (`- [x]`) marked рисует голым <input type=checkbox>
 * без имени — axe «label»: скринридер читал «флажок, отмечен» без смысла.
 * Имя — состояние словами; ставится ПОСЛЕ санитайзера, своим текстом локали.
 */
function labelTaskBoxes(html: string, labels: TaskLabels): string {
  return html.replace(/<input\b([^>]*\btype="checkbox"[^>]*)>/g, (whole, attrs: string) => {
    if (/\baria-label=/.test(attrs)) return whole;
    const checked = /\bchecked\b/.test(attrs);
    return `<input${attrs} aria-label="${attr(checked ? labels.done : labels.todo)}">`;
  });
}

function mdToHtml(md: string, labels: TaskLabels): string {
  return labelTaskBoxes(sanitizeMd(marked.parse(md) as string), labels);
}

/** Разбор markdown на HTML-сегменты и диаграммы (React владеет узлом диаграммы). */
export function toSegments(text: string, labels: TaskLabels = DEFAULT_TASK_LABELS): ProseSegment[] {
  const segs: ProseSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  DIAGRAM_FENCE.lastIndex = 0;
  while ((m = DIAGRAM_FENCE.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before.trim()) segs.push({ kind: 'html', html: mdToHtml(before, labels) });
    segs.push({ kind: m[1] as 'mermaid' | 'bpmn', def: m[2].trim() });
    last = DIAGRAM_FENCE.lastIndex;
  }
  const tail = text.slice(last);
  if (tail.trim()) segs.push({ kind: 'html', html: mdToHtml(tail, labels) });
  return segs;
}

/** Палитры диаграммы: роль mermaid → токен seidr.css. */
type DiagramPalette = { id: 'paper' | 'theme'; vars: Record<string, string> };
const PALETTES: DiagramPalette[] = [
  {
    id: 'paper',
    vars: {
      background: '--diagram-bg', primaryColor: '--diagram-node', primaryBorderColor: '--diagram-line',
      primaryTextColor: '--diagram-fg', secondaryTextColor: '--diagram-fg', tertiaryTextColor: '--diagram-fg',
      textColor: '--diagram-text', nodeTextColor: '--diagram-fg', lineColor: '--diagram-line',
      edgeLabelBackground: '--diagram-bg', titleColor: '--diagram-text',
    },
  },
  {
    id: 'theme',
    vars: {
      background: '--bg1', primaryColor: '--bg3', primaryBorderColor: '--acc', primaryTextColor: '--t1',
      secondaryColor: '--bg2', tertiaryColor: '--bg2', secondaryTextColor: '--t1', tertiaryTextColor: '--t1',
      textColor: '--t1', nodeTextColor: '--t1', lineColor: '--t2', edgeLabelBackground: '--bg1', titleColor: '--t1',
    },
  },
];

/** Значения токенов хоста; незаданный токен не передаём — mermaid возьмёт своё. */
function resolveVars(p: DiagramPalette): Record<string, string> {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return {};
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const [role, token] of Object.entries(p.vars)) {
    const v = cs.getPropertyValue(token).trim();
    if (v) out[role] = v;
  }
  const mono = cs.getPropertyValue('--mono').trim();
  const fs = cs.getPropertyValue('--fs-md').trim();
  if (mono) out.fontFamily = mono;
  if (fs) out.fontSize = fs;
  return out;
}

// ELK — только для flowchart/graph: другим типам layout:elk молча вешает рендер.
function isElkCompatible(def: string): boolean {
  const body = def
    .replace(/^\s*---[\s\S]*?---\s*/, '')
    .replace(/^(\s*%%\{[\s\S]*?\}%%\s*)+/, '')
    .replace(/^(\s*%%[^\n]*\r?\n)+/, '')
    .trimStart();
  return /^(flowchart|graph)\b/.test(body);
}

/** Заглушка до правки: склейка как была. */
export function withInit(def: string, init: string): string {
  return `${init}
${def}`;
}

function buildInit(p: DiagramPalette, elk: boolean): string {
  const cfg: Record<string, unknown> = { theme: 'base', flowchart: { htmlLabels: false }, themeVariables: resolveVars(p) };
  if (elk) cfg.layout = 'elk';
  return `%%{init: ${JSON.stringify(cfg)}}%%`;
}

export function MermaidDiagram({ def }: { def: string }) {
  const lang = useKitLang();
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const palette = PALETTES[idx];
  useEffect(() => {
    let active = true;
    setErr(null);
    mermaid.render(`sk-mermaid-${mermaidSeq++}`, `${buildInit(palette, isElkCompatible(def))}\n${def}`)
      .then(({ svg }) => { if (active) setSvg(svg); })
      .catch(e => { if (active) setErr(String((e as Error)?.message ?? e)); });
    return () => { active = false; };
  }, [def, palette]);

  if (err) {
    // Сообщение говорит, ЧТО не так; исходник под <details> показывает, где.
    return (
      <div className="sk-prose__diagram-err" role="alert">
        ⚠ mermaid: {err}
        <details>
          <summary>{kitT(lang, 'kit.prose.diagramSource')}</summary>
          <pre>{def}</pre>
        </details>
      </div>
    );
  }
  if (svg) {
    const label = kitT(lang, palette.id === 'paper' ? 'kit.prose.palettePaper' : 'kit.prose.paletteTheme');
    return (
      <div className="sk-prose__diagram">
        <button
          type="button"
          className="sk-prose__palette"
          onClick={() => setIdx(i => (i + 1) % PALETTES.length)}
          aria-label={`${kitT(lang, 'kit.prose.switchPalette')}: ${label}`}
          title={kitT(lang, 'kit.prose.switchPalette')}
        >{label}</button>
        <div
          className={`sk-prose__mermaid sk-prose__mermaid--${palette.id}`}
          dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }}
        />
      </div>
    );
  }
  return <div className="sk-prose__diagram-wait" aria-hidden />;
}

/** ```bpmn — BPMN 2.0 XML через bpmn-js NavigatedViewer (пан/зум, без правки). */
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
        (viewer.get('canvas') as { zoom: (mode: string) => void }).zoom('fit-viewport');
      })
      .catch((e: unknown) => { if (active) setErr(String((e as Error)?.message ?? e)); });
    return () => {
      active = false;
      viewer.destroy();
    };
  }, [def]);

  if (err) return <div className="sk-prose__diagram-err" role="alert">⚠ bpmn: {err}</div>;
  // Явная высота до importXML: у родителя с height:auto canvas схлопывается в 0.
  return <div ref={hostRef} className="sk-prose__bpmn" />;
}

export function MartProse({ text, style, className }: { text?: string | null; style?: CSSProperties; className?: string }) {
  const lang = useKitLang();
  const segments = useMemo(
    () => (text ? toSegments(text, { done: kitT(lang, 'kit.prose.taskDone'), todo: kitT(lang, 'kit.prose.taskTodo') }) : []),
    [text, lang],
  );
  if (!text) return null;
  return (
    <div className={['sk-prose', className].filter(Boolean).join(' ')} style={style}>
      {segments.map((seg, i) => {
        if (seg.kind === 'mermaid') return <MermaidDiagram key={i} def={seg.def} />;
        if (seg.kind === 'bpmn') return <BpmnDiagram key={i} def={seg.def} />;
        return <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />;
      })}
    </div>
  );
}
