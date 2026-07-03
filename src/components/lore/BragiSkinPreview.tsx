import { useEffect, useMemo } from 'react';
import { marked } from 'marked';

// REN-00 (SPRINT_BRAGI_PLATFORM_RENDER) — shared render engine for the BRAGI
// publication preview. Every platform "skin" (master / Telegram / VC / Habr /
// site / Telegraph) is the SAME markdown body (marked.parse) wrapped in a
// platform-authentic CSS frame — this mirrors the reference prototype's single
// md() + render()-with-branches, NOT five independent renderers
// (C:\Маркетинг\bragi-platform-render-prototype.html).
//
// Per-skin refinements (TG poll + teaser-from-asset, site theme toggle, char
// limits, validators) land in REN-02..05 / VAL-01; this file fixes the contract
// and ports the visuals so those tasks stay thin.
//
// Platform colours are INTENTIONALLY hardcoded (a Telegram preview must look
// like Telegram regardless of the active LORE theme). The master + site skins
// follow LORE tokens (var(--…)) because they represent our own surfaces.

marked.setOptions({ gfm: true, breaks: false });

export type BragiSkin = 'main' | 'tg' | 'vc' | 'habr' | 'site' | 'tgraph';

export interface BragiSkinPreviewProps {
  skin: BragiSkin;
  /** The effective markdown to render (inheritance already resolved by caller). */
  textMd: string;
  /** Teaser asset (filename or URL) shown above the body on platforms that use one. */
  teaser?: string | null;
  /** Only the 'site' skin renders two themes (REN-04). */
  siteTheme?: 'dark' | 'light';
  meta?: { channelName?: string; date?: string | null };
}

const SKIN_CSS = `
.bsk-wrap { height: 100%; }
/* ── Telegram ─────────────────────────────────────────────── */
.bsk-tg { background:#0e1621; border-radius:12px; padding:16px 12px; min-height:100%; }
.bsk-tg .img { max-width:430px; margin:0 auto 2px; border-radius:12px 12px 0 0; background:#1f2c3a; color:#708499; text-align:center; padding:44px 8px; font-size:12px; font-family:var(--mono),monospace; }
.bsk-tg .bub { background:#182533; border-radius:0 0 14px 14px; padding:9px 13px; max-width:430px; margin:0 auto; color:#f5f5f5; font-size:14.5px; line-height:1.45; font-family:-apple-system,'Segoe UI',Roboto,sans-serif; }
.bsk-tg .bub.noimg { border-radius:14px 14px 14px 4px; }
.bsk-tg .ch { font-size:13px; font-weight:600; color:#d4a830; margin-bottom:4px; }
.bsk-tg .bub p { margin:0 0 9px; }
.bsk-tg .bub h1, .bsk-tg .bub h2, .bsk-tg .bub h3 { font-size:15px; margin:0 0 9px; font-weight:600; }
.bsk-tg .bub code { background:rgba(255,255,255,.08); border-radius:4px; padding:0 4px; font-size:13px; }
.bsk-tg .bub a { color:#6ab3f3; text-decoration:none; }
.bsk-tg .bub img { max-width:100%; border-radius:8px; }
.bsk-tg .ft { display:flex; justify-content:flex-end; gap:6px; font-size:11.5px; color:#708499; margin-top:4px; }
/* ── VC.ru ────────────────────────────────────────────────── */
.bsk-vc { background:#fff; border-radius:12px; padding:26px 32px; color:#000; min-height:100%; font-family:-apple-system,'Segoe UI',Roboto,sans-serif; }
.bsk-vc .vch { display:flex; gap:8px; align-items:center; font-size:13px; color:#666; margin-bottom:12px; }
.bsk-vc .vch .a { width:24px; height:24px; border-radius:6px; background:#d4a830; }
.bsk-vc .cover { background:#f2f2f2; border:1px dashed #ccc; border-radius:8px; color:#999; text-align:center; padding:40px 10px; font-size:12px; margin-bottom:16px; font-family:var(--mono),monospace; }
.bsk-vc h1 { font-size:23px; line-height:1.25; margin:0 0 13px; font-weight:700; }
.bsk-vc h2 { font-size:18px; margin:18px 0 9px; font-weight:600; }
.bsk-vc p { font-size:15.5px; line-height:1.6; margin:0 0 11px; }
.bsk-vc code { background:#f4f4f4; border-radius:4px; padding:0 4px; font-size:14px; }
.bsk-vc a { color:#0f62fe; }
.bsk-vc em { color:#555; }
.bsk-vc img { max-width:100%; border-radius:8px; }
/* ── Habr ─────────────────────────────────────────────────── */
.bsk-habr { background:#f0f0f0; border-radius:12px; padding:14px; min-height:100%; }
.bsk-habr .card { background:#fff; border-radius:8px; padding:22px 26px; color:#333; max-width:640px; margin:0 auto; font-family:-apple-system,'Segoe UI',Verdana,sans-serif; }
.bsk-habr .kick { font-size:12px; color:#579; margin-bottom:8px; text-transform:uppercase; letter-spacing:.04em; }
.bsk-habr .timg { background:#f4f6f8; border:1px dashed #d5dbe0; border-radius:6px; color:#999; text-align:center; padding:36px 8px; font-size:12px; margin-bottom:14px; font-family:var(--mono),monospace; }
.bsk-habr h1 { font-size:21px; margin:0 0 11px; font-weight:700; color:#222; }
.bsk-habr h2 { font-size:17px; margin:16px 0 8px; color:#222; }
.bsk-habr p { font-size:14.5px; line-height:1.6; margin:0 0 10px; }
.bsk-habr code { background:#f3f3f3; border:1px solid #e5e5e5; border-radius:3px; padding:0 4px; font-size:13px; color:#c7254e; }
.bsk-habr a { color:#548eaa; }
.bsk-habr img { max-width:100%; border-radius:6px; }
/* ── Site (our own — follows LORE theme) — dark + light ───── */
.bsk-site { background:var(--bg0); border:1px solid var(--bd); border-radius:12px; padding:24px 28px; min-height:100%; }
.bsk-site .timg { background:var(--bg1); border:1px dashed var(--bd); border-radius:8px; color:var(--t3); text-align:center; padding:40px 8px; font-size:11px; margin-bottom:16px; font-family:var(--mono),monospace; }
.bsk-site h1 { font-family:var(--font); font-weight:700; font-size:20px; color:var(--t1); margin:0 0 13px; }
.bsk-site h2 { font-weight:600; font-size:16px; color:var(--acc); margin:18px 0 8px; }
.bsk-site p { font-size:14.5px; line-height:1.65; color:var(--t2); margin:0 0 11px; }
.bsk-site strong { color:var(--t1); }
.bsk-site code { font-family:var(--mono); background:var(--bg2); border-radius:4px; padding:0 5px; font-size:12.5px; color:var(--acc); }
.bsk-site a { color:var(--acc); }
.bsk-site img { max-width:100%; border-radius:8px; }
.bsk-site.light { background:#faf7ef; border-color:#e2dccc; }
.bsk-site.light h1 { color:#2c2717; }
.bsk-site.light h2 { color:#8a6b14; }
.bsk-site.light p { color:#5c5440; }
.bsk-site.light strong { color:#2c2717; }
.bsk-site.light code { background:#f0ead8; color:#8a6b14; }
.bsk-site.light .timg { background:#f3efe3; border-color:#e2dccc; color:#a09878; }
.bsk-main .mhead { font-size:11px; color:var(--t3); font-family:var(--mono); margin-bottom:12px; }
/* ── Telegraph (Instant View) ─────────────────────────────── */
.bsk-tgraph { background:#fff; border-radius:12px; padding:30px 26px; min-height:100%; font-family:Georgia,'Times New Roman',serif; color:#222; }
.bsk-tgraph .inner { max-width:600px; margin:0 auto; }
.bsk-tgraph h1 { font-size:26px; line-height:1.25; margin:0 0 6px; font-weight:700; }
.bsk-tgraph h2 { font-size:20px; margin:22px 0 10px; }
.bsk-tgraph p { font-size:17px; line-height:1.65; margin:0 0 14px; }
.bsk-tgraph .timg { background:#f6f6f6; border:1px dashed #ddd; border-radius:6px; color:#aaa; text-align:center; padding:46px 8px; font-size:12px; margin-bottom:16px; font-family:var(--mono),monospace; }
.bsk-tgraph code { background:#f4f4f4; border-radius:4px; padding:0 5px; font-family:var(--mono); font-size:14px; }
.bsk-tgraph a { color:#00a3d9; }
.bsk-tgraph img { max-width:100%; border-radius:6px; }
.bsk-tgraph .byline { font-size:13.5px; color:#999; font-family:-apple-system,'Segoe UI',sans-serif; margin-bottom:18px; }
.bsk-tgraph .byline a { color:#999; }
`;

let cssInjected = false;
function injectCssOnce(): void {
  if (cssInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.dataset.bragiSkin = '1';
  style.textContent = SKIN_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

function md(text: string): string {
  return text && text.trim() ? (marked.parse(text) as string) : '';
}

/** Inner body — the markdown rendered to HTML. Shared by every skin. */
function Body({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function BragiSkinPreview({ skin, textMd, teaser, siteTheme = 'dark', meta }: BragiSkinPreviewProps) {
  useEffect(() => { injectCssOnce(); }, []);
  const html = useMemo(() => md(textMd), [textMd]);
  const tz = teaser && teaser.trim() ? teaser.trim() : null;
  const date = meta?.date || '';

  switch (skin) {
    case 'tg':
      return (
        <div className="bsk-wrap"><div className="bsk-tg">
          {tz && <div className="img">тизер: {tz}</div>}
          <div className={`bub${tz ? '' : ' noimg'}`}>
            {meta?.channelName && <div className="ch">{meta.channelName}</div>}
            <Body html={html} />
            <div className="ft"><span>👁 —</span><span>{date || '—'}</span></div>
          </div>
        </div></div>
      );
    case 'vc':
      return (
        <div className="bsk-wrap"><div className="bsk-vc">
          <div className="vch"><span className="a" />{meta?.channelName ?? 'Автор'} · {date || 'не назначена'}</div>
          <div className="cover">тизер: {tz ?? 'нет — возьмётся cover публикации'}</div>
          <Body html={html} />
        </div></div>
      );
    case 'habr':
      return (
        <div className="bsk-wrap"><div className="bsk-habr"><div className="card">
          <div className="kick">Data Engineering · Блог Seiðr Studio</div>
          {tz && <div className="timg">тизер: {tz}</div>}
          <Body html={html} />
        </div></div></div>
      );
    case 'site':
      return (
        <div className="bsk-wrap"><div className={`bsk-site${siteTheme === 'light' ? ' light' : ''}`}>
          {tz && <div className="timg">обложка темы: {siteTheme === 'light' ? 'og-light.png' : 'og-dark.png'}</div>}
          <Body html={html} />
        </div></div>
      );
    case 'tgraph':
      return (
        <div className="bsk-wrap"><div className="bsk-tgraph"><div className="inner">
          {tz && <div className="timg">header: {tz}</div>}
          <Body html={html} />
          <div className="byline" style={{ marginTop: 18 }}>Seiðr Studio · <a href="#">seidrstudio.pro</a> · Instant View</div>
        </div></div></div>
      );
    case 'main':
    default:
      return (
        <div className="bsk-wrap"><div className="bsk-site bsk-main">
          <div className="mhead">MAIN · мастер-версия (MD) — сателлиты наследуют или переопределяют</div>
          <Body html={html} />
        </div></div>
      );
  }
}
