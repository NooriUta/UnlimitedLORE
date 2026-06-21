// LAL-27: sandboxed iframe renderer for KnowDoc HTML fragments.
// Air-gap safe: CSP meta blocks external loads; sandbox="allow-scripts"
// prevents navigation, popups, and form submission.
// Height auto-fits via postMessage from inside the iframe (resize shim).
import { useEffect, useRef, useState } from 'react';

interface Props {
  html: string;
  title?: string;
  minHeight?: number;
}

// CSP injected into every document: no external resources, no mixed content.
const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "img-src data: blob:",
].join('; ');

// Resize-shim injected at the end of every document body.
const RESIZE_SHIM = `<script>
(function(){
  function post(){window.parent.postMessage({_seerResize:document.documentElement.scrollHeight},'*');}
  post();
  new MutationObserver(post).observe(document.body,{childList:true,subtree:true,attributes:true});
  window.addEventListener('load',post);
})();
</script>`;

function wrapHtml(html: string, title: string): string {
  return (
    `<!DOCTYPE html><html><head>` +
    `<meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<title>${title.replace(/</g,'&lt;')}</title>` +
    `<style>body{margin:0;font-family:system-ui,sans-serif;font-size:13px;` +
    `color:#cdd0d4;background:transparent;word-break:break-word;}` +
    `a{color:#7cbcf8;}pre,code{background:#0004;border-radius:3px;padding:2px 4px;}` +
    `table{border-collapse:collapse;}td,th{padding:4px 8px;border:1px solid #333;}</style>` +
    `</head><body>${html}${RESIZE_SHIM}</body></html>`
  );
}

export default function SandboxedHtmlFrame({ html, title = '', minHeight = 120 }: Props) {
  const [height, setHeight] = useState(minHeight);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const h = e.data?._seerResize;
      if (typeof h === 'number' && h > 0) setHeight(Math.max(minHeight, h + 8));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [minHeight]);

  return (
    <iframe
      ref={frameRef}
      srcDoc={wrapHtml(html, title)}
      title={title || 'KnowDoc'}
      sandbox="allow-scripts"
      style={{
        width: '100%', height,
        border: 'none', display: 'block',
        borderRadius: 4,
        background: 'transparent',
      }}
    />
  );
}
