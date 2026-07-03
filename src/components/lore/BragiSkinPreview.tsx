import { useEffect, useMemo, useState } from 'react';
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
/* ── Site (seidrstudio.pro's own skin) — colors + typography copied
   VERBATIM from the real site repo (C:\AIDA\seidr-site), not approximated:
   src/styles/globals.css ":root"/"[data-theme=light]" for the two palettes,
   src/styles/article.css ".article-content" for headings/body/code/quote.
   Both variants hardcoded (not var(--…)) so the preview stays independent
   of the LORE app's own theme/mode — switching LORE itself to light mode
   must not affect what "dark site theme" looks like. Unbounded/Manrope/
   IBM Plex Mono are already loaded app-wide (tokens.css @import, same
   Google Fonts URL the site itself uses), so referencing them directly
   here needs no extra font loading. */
.bsk-site {
  background:#141108; border:1px solid #42382a; border-radius:12px; padding:24px 28px; min-height:100%;
  font-family:'Manrope',sans-serif;
}
.bsk-site .timg { background:#1c1810; border:1px dashed #42382a; border-radius:8px; color:#8a7e66; text-align:center; padding:40px 8px; font-size:11px; margin-bottom:16px; font-family:'IBM Plex Mono',monospace; }
.bsk-site h1 { font-family:'Unbounded',sans-serif; font-weight:700; font-size:22px; line-height:1.2; color:#ede5d0; margin:0 0 16px; }
.bsk-site h2 { font-family:'Unbounded',sans-serif; font-weight:600; font-size:17px; color:#ede5d0; margin:24px 0 10px; }
.bsk-site p { font-size:14.5px; line-height:1.7; color:#9a8c6e; margin:0 0 12px; }
.bsk-site strong { color:#ede5d0; }
.bsk-site code { font-family:'IBM Plex Mono',monospace; background:#1c1810; border:1px solid #42382a; border-radius:4px; padding:1px 5px; font-size:0.875em; color:#ede5d0; }
.bsk-site pre { background:#1c1810; border:1px solid #42382a; border-radius:8px; padding:14px 16px; margin:16px 0; overflow-x:auto; }
.bsk-site pre code { background:none; border:none; padding:0; }
.bsk-site blockquote { border-left:3px solid #A8B860; padding-left:14px; margin:16px 0; color:#9a8c6e; font-style:italic; }
.bsk-site a { color:#A8B860; text-decoration:underline; text-decoration-color:#A8B86066; }
.bsk-site img { max-width:100%; border-radius:8px; }
.bsk-site.light { background:#f5f3ee; border-color:#d4ccb8; }
.bsk-site.light .timg { background:#faf8f3; border-color:#d4ccb8; color:#9a8a6e; }
.bsk-site.light h1, .bsk-site.light h2 { color:#1e1a12; }
.bsk-site.light p { color:#5c5240; }
.bsk-site.light strong { color:#1e1a12; }
.bsk-site.light code { background:#faf8f3; border-color:#d4ccb8; color:#1e1a12; }
.bsk-site.light pre { background:#faf8f3; border-color:#d4ccb8; }
.bsk-site.light blockquote { border-left-color:#6b7a2a; color:#5c5240; }
.bsk-site.light a { color:#6b7a2a; text-decoration-color:#6b7a2a66; }
/* Master/"мастер" tab is the editorial source-of-truth view (not a
   real-platform preview) — it intentionally keeps following the LORE app's
   own active theme/palette, same specificity as .bsk-site so source order
   decides; placed after the fixed-dark rules above to win. */
.bsk-main { background:var(--bg0); border-color:var(--bd); }
.bsk-main .timg { background:var(--bg1); border-color:var(--bd); color:var(--t3); }
.bsk-main h1 { color:var(--t1); }
.bsk-main h2 { color:var(--acc); }
.bsk-main p { color:var(--t2); }
.bsk-main strong { color:var(--t1); }
.bsk-main code { background:var(--bg2); color:var(--acc); }
.bsk-main a { color:var(--acc); }
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
/* Real teaser/cover image (replaces the placeholder box when the asset is a loadable URL). */
.bsk-tg .tzimg { display:block; width:100%; max-width:430px; margin:0 auto 2px; border-radius:12px 12px 0 0; object-fit:cover; max-height:260px; }
.bsk-vc .tzimg, .bsk-habr .tzimg, .bsk-site .tzimg, .bsk-tgraph .tzimg, .bsk-main .tzimg { display:block; width:100%; margin:0 0 16px; border-radius:8px; object-fit:cover; max-height:340px; }
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

/** Teaser/cover slot: renders the real asset as an <img> when it's a loadable
 * URL (http/blob/data/root-relative), else a labelled placeholder box — so a
 * `repo:…` local ref or a bare filename degrades gracefully instead of showing
 * a broken image (mirrors the Thumb onError fallback in LoreBragiPublications). */
function Teaser({ tz, box, label }: { tz: string; box: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const loadable = /^(https?:\/\/|blob:|data:|\/)/.test(tz.trim());
  if (loadable && !failed) return <img className="tzimg" src={tz} alt="" onError={() => setFailed(true)} />;
  return <div className={box}>{label}{tz}</div>;
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
          {tz && <Teaser tz={tz} box="img" label="тизер: " />}
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
          {tz ? <Teaser tz={tz} box="cover" label="тизер: " /> : <div className="cover">тизер: нет — возьмётся cover публикации</div>}
          <Body html={html} />
        </div></div>
      );
    case 'habr':
      return (
        <div className="bsk-wrap"><div className="bsk-habr"><div className="card">
          <div className="kick">Data Engineering · Блог Seiðr Studio</div>
          {tz && <Teaser tz={tz} box="timg" label="тизер: " />}
          <Body html={html} />
        </div></div></div>
      );
    case 'site':
      return (
        <div className="bsk-wrap"><div className={`bsk-site${siteTheme === 'light' ? ' light' : ''}`}>
          {tz && <Teaser tz={tz} box="timg" label={`обложка (${siteTheme === 'light' ? 'светлая' : 'тёмная'}): `} />}
          <Body html={html} />
        </div></div>
      );
    case 'tgraph':
      return (
        <div className="bsk-wrap"><div className="bsk-tgraph"><div className="inner">
          {tz && <Teaser tz={tz} box="timg" label="header: " />}
          <Body html={html} />
          <div className="byline" style={{ marginTop: 18 }}>Seiðr Studio · <a href="#">seidrstudio.pro</a> · Instant View</div>
        </div></div></div>
      );
    case 'main':
    default:
      return (
        <div className="bsk-wrap"><div className="bsk-site bsk-main">
          <div className="mhead">MAIN · мастер-версия (MD) — сателлиты наследуют или переопределяют</div>
          {tz && <Teaser tz={tz} box="timg" label="обложка: " />}
          <Body html={html} />
        </div></div>
      );
  }
}
