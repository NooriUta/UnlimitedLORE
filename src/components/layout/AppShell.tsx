import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { GameIcon } from '../lore/GameIcon';
import { SHELL_TABS, type ShellTab } from './shellNav';
import { useIsNarrow } from '../../hooks/useMediaQuery';

const HEADER_H = 42;
const accentSoft = 'color-mix(in srgb, var(--acc) 12%, transparent)';

type Palette = 'amber' | 'slate';
type Mode    = 'dark'  | 'light';

function activeTabId(pathname: string): ShellTab['id'] {
  if (pathname.startsWith('/benchmark')) return 'research';
  if (pathname.startsWith('/muninn'))    return 'muninn';
  if (pathname.startsWith('/tyr'))       return 'tyr';
  if (pathname.startsWith('/bragi'))     return 'bragi';
  return 'projects';
}

export default function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const active = activeTabId(pathname);
  const lang = i18n.language?.startsWith('en') ? 'en' : 'ru';
  // MOB-01: below ~720px the tab labels + text toggles overflow the header
  // (~447px at 375px). Go icon-only for tabs and symbol-only for the palette
  // toggle so everything fits without clipping.
  const narrow = useIsNarrow(720);

  const [palette, setPalette] = useState<Palette>(() => {
    const saved = localStorage.getItem('lore-palette') ?? localStorage.getItem('lore-theme');
    return (saved === 'slate') ? 'slate' : 'amber';
  });
  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem('lore-mode') ?? localStorage.getItem('lore-theme');
    return (saved === 'light') ? 'light' : 'dark';
  });

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-theme', palette);
    if (mode === 'light') el.setAttribute('data-mode', 'light');
    else                  el.removeAttribute('data-mode');
    localStorage.setItem('lore-palette', palette);
    localStorage.setItem('lore-mode',    mode);
  }, [palette, mode]);

  const togglePalette = () => setPalette(p => p === 'amber' ? 'slate' : 'amber');
  const toggleMode    = () => setMode(m => m === 'dark' ? 'light' : 'dark');

  const btnStyle = {
    background: 'transparent',
    border: '1px solid var(--bd)',
    borderRadius: 'var(--seer-radius-sm, 4px)',
    cursor: 'pointer',
    color: 'var(--t2)',
    fontFamily: 'var(--mono)',
    fontSize: 11,
    padding: '3px 8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  };

  return (
    // MOB-10: height via .shell-dvh (100dvh + vh fallback + safe-area) — inline
    // 100vh hid the bottom of the UI under mobile browser chrome.
    <div className="shell-dvh" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header
        style={{
          height: HEADER_H,
          flexShrink: 0,
          background: 'var(--bg0)',
          borderBottom: '1px solid var(--bd)',
          display: 'flex',
          alignItems: 'center',
          gap: narrow ? 4 : 10,
          padding: narrow ? '0 8px' : '0 14px',
          zIndex: 100,
        }}
      >
        {/* Brand */}
        <button
          type="button"
          onClick={() => navigate('/lore?section=plan')}
          title="LORE"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            color: 'var(--t1)',
            fontFamily: 'var(--display)',
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: '0.04em',
            lineHeight: 1,
          }}
        >
          LORE
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--bd)', margin: '0 2px' }} />

        {/* Tabs — on narrow these relocate to the bottom tab bar (MOB-12);
            here the nav stays as a flex spacer that pushes the toggles right. */}
        <nav style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflowX: 'auto' }}>
          {!narrow && SHELL_TABS.map(tab => {
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                title={t(tab.labelKey, tab.fallback)}
                onClick={() => navigate(tab.to)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: narrow ? '6px 8px' : '6px 12px',
                  flex: 'none',
                  border: 'none',
                  borderRadius: 'var(--seer-radius-md, 6px)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontFamily: 'var(--font)',
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? accentSoft : 'transparent',
                  color: isActive ? 'var(--acc)' : 'var(--t2)',
                  transition: 'background 120ms, color 120ms',
                }}
                onMouseEnter={e => {
                  if (!isActive) e.currentTarget.style.background = 'var(--bg2)';
                }}
                onMouseLeave={e => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <GameIcon slug={tab.icon} size={15} style={{ color: 'inherit', transform: tab.flipX ? 'scaleX(-1)' : undefined }} />
                {!narrow && <span>{t(tab.labelKey, tab.fallback)}</span>}
              </button>
            );
          })}
        </nav>

        {/* Palette toggle */}
        <button
          type="button"
          onClick={togglePalette}
          title={`Палитра: ${palette}`}
          style={btnStyle}
        >
          {palette === 'amber' ? '◑' : '◐'}{narrow ? '' : ` ${palette}`}
        </button>

        {/* Dark / light toggle */}
        <button
          type="button"
          onClick={toggleMode}
          title={mode === 'dark' ? 'Светлый режим' : 'Тёмный режим'}
          style={btnStyle}
        >
          {mode === 'dark' ? '🌙' : '☀'}
        </button>

        {/* Language toggle */}
        <button
          type="button"
          onClick={() => i18n.changeLanguage(lang === 'ru' ? 'en' : 'ru')}
          title={lang === 'ru' ? 'Switch to English' : 'Переключить на русский'}
          style={btnStyle}
        >
          {lang === 'ru' ? 'RU' : 'EN'}
        </button>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Outlet />
      </div>

      {/* MOB-12: bottom tab bar for the 5 hypostases in the thumb zone. Only on
          narrow — the top nav drops its tabs there. Rendered as a flex sibling
          (not fixed) so it never overlaps content or BRAGI's top-of-content
          subtabs; safe-area padding keeps it clear of the home indicator. */}
      {narrow && (
        <nav
          style={{
            flexShrink: 0,
            display: 'flex',
            background: 'var(--bg0)',
            borderTop: '1px solid var(--bd)',
            paddingBottom: 'env(safe-area-inset-bottom, 0)',
            zIndex: 100,
          }}
        >
          {SHELL_TABS.map(tab => {
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                title={t(tab.labelKey, tab.fallback)}
                onClick={() => navigate(tab.to)}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  padding: '7px 0 5px',
                  border: 'none',
                  borderTop: `2px solid ${isActive ? 'var(--acc)' : 'transparent'}`,
                  background: isActive ? accentSoft : 'transparent',
                  cursor: 'pointer',
                  color: isActive ? 'var(--acc)' : 'var(--t2)',
                  transition: 'background 120ms, color 120ms',
                }}
              >
                <GameIcon slug={tab.icon} size={20} style={{ color: 'inherit', transform: tab.flipX ? 'scaleX(-1)' : undefined }} />
                <span style={{ fontSize: 9, letterSpacing: '0.02em', lineHeight: 1 }}>{t(tab.labelKey, tab.fallback)}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
