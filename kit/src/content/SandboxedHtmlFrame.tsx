// SandboxedHtmlFrame (S4-00d) — HTML-фрагменты только в песочнице. Копия v1
// src/components/lore/SandboxedHtmlFrame.tsx (LAL-27): подпись по умолчанию —
// из локалей kit, стиль рамки — класс sk-frame в seidr.css.
// Air-gap: CSP в документе запрещает внешние загрузки; sandbox="allow-scripts"
// без allow-same-origin — нет навигации, всплывающих окон, отправки форм и
// доступа к хосту. Высота подстраивается по postMessage изнутри (resize-шим).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { kitT } from '../i18n';
import { useKitLang } from '../i18n/lang';
import { frameThemeCss, hostFrameTheme, type FrameTheme } from './sandboxFrameTheme';

export interface SandboxedHtmlFrameProps {
  html: string;
  title?: string;
  minHeight?: number;
}

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'img-src data: blob:',
].join('; ');

const RESIZE_SHIM = `<script>
(function(){
  function post(){window.parent.postMessage({_skResize:document.documentElement.scrollHeight},'*');}
  post();
  new MutationObserver(post).observe(document.body,{childList:true,subtree:true,attributes:true});
  window.addEventListener('load',post);
})();
</script>`;

export function wrapSandboxHtml(html: string, title: string, theme: FrameTheme): string {
  return (
    `<!DOCTYPE html><html><head>` +
    `<meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<title>${title.replace(/</g, '&lt;')}</title>` +
    `<style>${frameThemeCss(theme)}</style>` +
    `</head><body>${html}${RESIZE_SHIM}</body></html>`
  );
}

export function SandboxedHtmlFrame({ html, title = '', minHeight = 120 }: SandboxedHtmlFrameProps) {
  const lang = useKitLang();
  const [height, setHeight] = useState(minHeight);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Тема хоста В МЕСТЕ РАМКИ (K4-SANDBOX-DARK-CONTRAST): токены и color-scheme
  // читаются у самого iframe — тема поддерева ([data-mode] на обёртке) тоже доходит.
  // Перечитывается при смене режима/палитры на любом предке (subtree).
  const [theme, setTheme] = useState<FrameTheme>(hostFrameTheme);
  useLayoutEffect(() => {
    const read = () => {
      const next = hostFrameTheme(frameRef.current);
      setTheme(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    read();
    if (typeof MutationObserver === 'undefined') return;
    // Корень — как раньше (режим, палитра, класс, инлайн-токены); поддерево — только
    // режим и палитра: class/style по всему документу меняются на каждый чих.
    // Два наблюдателя: повторный observe того же узла заменил бы параметры первого.
    const root = new MutationObserver(read);
    root.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-theme', 'class', 'style'] });
    const tree = new MutationObserver(read);
    tree.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-mode', 'data-theme'] });
    return () => { root.disconnect(); tree.disconnect(); };
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const h = e.data?._skResize;
      if (typeof h === 'number' && h > 0) setHeight(Math.max(minHeight, h + 8));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [minHeight]);

  const shownTitle = title || kitT(lang, 'kit.frame.defaultTitle');
  return (
    <iframe
      ref={frameRef}
      className="sk-frame"
      srcDoc={wrapSandboxHtml(html, shownTitle, theme)}
      title={shownTitle}
      sandbox="allow-scripts"
      style={{ height }}
    />
  );
}
