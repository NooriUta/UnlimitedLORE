import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { GameIcon } from '../lore/GameIcon';
import { SHELL_TABS, type ShellTab } from './shellNav';

const HEADER_H = 42;
const accentSoft = 'color-mix(in srgb, var(--acc) 12%, transparent)';

type Theme = 'amber' | 'slate' | 'light';
const THEMES: { id: Theme; label: string }[] = [
  { id: 'amber', label: '◑' },
  { id: 'slate', label: '◐' },
  { id: 'light', label: '○' },
];

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

  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('lore-theme') as Theme) ?? 'amber',
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('lore-theme', theme);
  }, [theme]);

  const cycleTheme = () => {
    const order: Theme[] = ['amber', 'slate', 'light'];
    setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  };

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <header
        style={{
          height: HEADER_H,
          flexShrink: 0,
          background: 'var(--bg0)',
          borderBottom: '1px solid var(--bd)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 14px',
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

        {/* Tabs */}
        <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
          {SHELL_TABS.map(tab => {
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => navigate(tab.to)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '6px 12px',
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
                <span>{t(tab.labelKey, tab.fallback)}</span>
              </button>
            );
          })}
        </nav>

        {/* Theme cycle */}
        <button
          type="button"
          onClick={cycleTheme}
          title={`Тема: ${theme}`}
          style={btnStyle}
        >
          {THEMES.find(t => t.id === theme)?.label ?? '◑'} {theme}
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
    </div>
  );
}
