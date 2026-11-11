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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import mermaid from 'mermaid';
import elkLayouts from '@mermaid-js/layout-elk';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import { marked } from './markdown';
import { DIAGRAM_LANGS, splitDiagramFences } from './diagramFence';
import { LiveBlock, type LiveBlocks } from './LiveBlock';
import { useNarrow } from '../core/narrow';
import { sanitizeMd, sanitizeSvg } from './sanitizeHtml';
import { kitT } from '../i18n';
import { useKitLang } from '../i18n/lang';
import { useRefPeek, type MartRefPeek } from './RefPeekLayer';

export type { MartRefPeek, MartPeekRef } from './RefPeekLayer';

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
  | { kind: 'bpmn'; def: string }
  /** Живой блок (S6-04): язык назван приложением в пропе blocks. */
  | { kind: 'live'; lang: string; def: string };

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

/**
 * Разбор markdown на HTML-сегменты и диаграммы (React владеет узлом диаграммы).
 *
 * Решение «это диаграмма» принимает splitDiagramFences — по правилам фенса
 * CommonMark. Текст, который диаграммой не объявлен, рендереру диаграмм не
 * достаётся никогда: иначе проза уезжает в mermaid и возвращается его
 * англоязычной ошибкой поверх содержимого (дефект владелицы 10.11.2026).
 */
export function toSegments(text: string, labels: TaskLabels = DEFAULT_TASK_LABELS, liveLangs: readonly string[] = []): ProseSegment[] {
  const segs: ProseSegment[] = [];
  // Живые языки (S6-04) идут тем же правилом фенса, что диаграммы, — второй регулярки нет.
  const live = liveLangs.filter(l => !(DIAGRAM_LANGS as readonly string[]).includes(l));
  for (const part of splitDiagramFences(text, [...DIAGRAM_LANGS, ...live])) {
    if (part.kind === 'diagram' && live.includes(part.lang)) {
      segs.push({ kind: 'live', lang: part.lang, def: part.def });
    } else if (part.kind === 'diagram') {
      segs.push({ kind: part.lang as 'mermaid' | 'bpmn', def: part.def });
    } else if (part.text.trim()) {
      segs.push({ kind: 'html', html: mdToHtml(part.text, labels) });
    }
  }
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

/**
 * Строка %%{init}%% — после фронтматтера, а не перед ним. Mermaid узнаёт фронтматтер
 * (`---` / `config:` / `layout: elk` / `---`, правило владелицы 08.11.2026 для всех диаграмм)
 * только в самом начале текста; init перед ним превращал его в «граф» с ошибкой разбора
 * (прод 09.11, ADR-MINILORE-007: «Parse error on line 1: ---config: layout»).
 */
export function withInit(def: string, init: string): string {
  const fm = /^\s*(---\r?\n[\s\S]*?\r?\n---[ \t]*)(\r?\n|$)/.exec(def);
  if (!fm) return `${init}\n${def}`;
  return `${fm[1]}\n${init}\n${def.slice(fm[0].length)}`;
}

function buildInit(p: DiagramPalette, elk: boolean): string {
  const cfg: Record<string, unknown> = { theme: 'base', flowchart: { htmlLabels: false }, themeVariables: resolveVars(p) };
  if (elk) cfg.layout = 'elk';
  return `%%{init: ${JSON.stringify(cfg)}}%%`;
}

/**
 * Объявленную диаграмму не удалось нарисовать — честная оговорка ВМЕСТЕ с
 * исходником блока. Доктрина: «не смогли нарисовать» ≠ «пусто», содержимое не
 * теряется. Сырое сообщение библиотеки (англоязычное, про внутренности) больше
 * не встаёт поверх содержимого — оно уходит в «техническую причину».
 */
function DiagramFailure({ kind, def, err }: { kind: 'mermaid' | 'bpmn'; def: string; err: string }) {
  const lang = useKitLang();
  return (
    <div className="sk-prose__diagram-err" role="alert">
      <p className="sk-prose__diagram-err-why">⚠ {kitT(lang, 'kit.prose.diagramFailed')}</p>
      <p className="sk-prose__diagram-err-cap">{kitT(lang, 'kit.prose.diagramSource')}</p>
      <pre className="sk-prose__diagram-err-src">{def}</pre>
      <details className="sk-prose__diagram-err-tech">
        <summary>{kitT(lang, 'kit.prose.diagramReason')}</summary>
        <pre>{`${kind}: ${err}`}</pre>
      </details>
    </div>
  );
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
    mermaid.render(`sk-mermaid-${mermaidSeq++}`, withInit(def, buildInit(palette, isElkCompatible(def))))
      .then(({ svg }) => { if (active) setSvg(svg); })
      .catch(e => { if (active) setErr(String((e as Error)?.message ?? e)); });
    return () => { active = false; };
  }, [def, palette]);

  if (err) return <DiagramFailure kind="mermaid" def={def} err={err} />;
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

  // То же правило, что у mermaid: оговорка и исходник блока, а не одна ошибка
  // вместо содержимого (раньше текст схемы здесь пропадал совсем).
  if (err) return <DiagramFailure kind="bpmn" def={def} err={err} />;
  // Явная высота до importXML: у родителя с height:auto canvas схлопывается в 0.
  return <div ref={hostRef} className="sk-prose__bpmn" />;
}

/**
 * [[ссылка]] в чтении → ссылка на паспорт записи (SPRINT_UXR_S10_SEIDR_KIT_2/MD-READ-PEEK,
 * D-2026-LORE-MD-REF-EDIT-IN-PASSPORT). Адрес даёт приложение; null — рамка остаётся без ссылки.
 */
export type MartRefHref = (ref: { id: string; type: string | null }) => string | null;

/** Рамки .sk-wref, для которых приложение знает адрес, становятся <a href> с теми же атрибутами. */
function linkRefs(root: HTMLElement, refHref: MartRefHref) {
  root.querySelectorAll<HTMLSpanElement>('span.sk-wref').forEach(span => {
    const id = span.getAttribute('data-ref') ?? '';
    const href = id ? refHref({ id, type: span.getAttribute('data-ref-type') }) : null;
    if (!href) return;
    const a = document.createElement('a');
    for (const at of Array.from(span.attributes)) a.setAttribute(at.name, at.value);
    a.setAttribute('href', href);
    a.textContent = span.textContent;
    span.replaceWith(a);
  });
}

/** refPeek — карточка Peek со ссылки (S9-10): мышь — наведение, палец — нижний лист. */
export function MartProse({ text, style, className, refHref, refPeek, blocks, narrow: narrowProp }: {
  text?: string | null; style?: CSSProperties; className?: string; refHref?: MartRefHref; refPeek?: MartRefPeek;
  /** S6-04: живые блоки — язык фенса → исполнитель (даёт приложение). */
  blocks?: LiveBlocks;
  narrow?: boolean;
}) {
  const lang = useKitLang();
  const narrow = useNarrow(narrowProp);
  const liveKey = blocks ? Object.keys(blocks).sort().join(',') : '';
  const segments = useMemo(
    () => (text ? toSegments(text, { done: kitT(lang, 'kit.prose.taskDone'), todo: kitT(lang, 'kit.prose.taskTodo') }, liveKey ? liveKey.split(',') : []) : []),
    [text, lang, liveKey],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  // После каждой отрисовки html (React перезаписывает innerHTML сегмента при смене текста).
  useLayoutEffect(() => {
    if (refHref && rootRef.current) linkRefs(rootRef.current, refHref);
  }, [segments, refHref]);
  // Хук — до раннего выхода: порядок хуков не должен зависеть от того, есть ли текст.
  const peek = useRefPeek(refPeek);
  if (!text) return null;
  return (
    <div ref={rootRef} className={['sk-prose', className].filter(Boolean).join(' ')} style={style} {...peek.handlers}>
      {peek.layer}
      {segments.map((seg, i) => {
        if (seg.kind === 'mermaid') return <MermaidDiagram key={i} def={seg.def} />;
        if (seg.kind === 'bpmn') return <BpmnDiagram key={i} def={seg.def} />;
        if (seg.kind === 'live') {
          const run = blocks?.[seg.lang];
          if (run) return <LiveBlock key={i} lang={seg.lang} source={seg.def} run={run} narrow={narrow} />;
          return null;
        }
        return <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />;
      })}
    </div>
  );
}
