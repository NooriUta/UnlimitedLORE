import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { GameIcon } from '../lore/GameIcon';
import { SHELL_TABS, type ShellTab } from './shellNav';
import { useIsNarrow } from '../../hooks/useMediaQuery';
import { AUTH_ENABLED, displayName, logout } from '../../auth/session';
import { useIsAdmin } from '../../auth/useRole';

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
  // ADR-LORE-025: админка администрирует ВЕСЬ LORE (словари/проекты/люди/агенты),
  // а не раздел Forseti — вход живёт здесь, в шапке приложения. Гейт — D8.
  const isAdmin = useIsAdmin();
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

  // ── Seiðr-шапка: бренд/тенант/«ещё» как dropdown'ы + палитра поиска ──────────
  const [openDD, setOpenDD] = useState<null | 'brand' | 'tenant' | 'more'>(null);
  const [tenant, setTenant] = useState('DEFAULT');
  const [palOpen, setPalOpen] = useState(false);
  const [palQ, setPalQ] = useState('');
  const activeTab = SHELL_TABS.find(x => x.id === active);

  // Закрытие dropdown — outside-click (mousedown) + Esc, НЕ onBlur: blur
  // срабатывает раньше клика в Firefox/Safari и съедает выбор.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-dd]')) setOpenDD(null);
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = /^(INPUT|TEXTAREA)$/.test(el?.tagName ?? '');
      if (e.key === 'Escape') { setOpenDD(null); setPalOpen(false); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPalOpen(true); return; }
      if (e.key === '/' && !typing && !palOpen) { e.preventDefault(); setPalOpen(true); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [palOpen]);

  const submitSearch = () => {
    const q = palQ.trim();
    setPalOpen(false); setPalQ('');
    navigate(q ? `/lore?section=plan&q=${encodeURIComponent(q)}` : '/lore?section=plan');
  };

  const liveDot = { width: 7, height: 7, borderRadius: '50%', background: 'var(--suc)', flexShrink: 0, display: 'inline-block' as const };
  const caret   = { color: 'var(--t3)', fontSize: 10 };
  const pill = (brand: boolean) => ({
    display: 'inline-flex' as const, alignItems: 'center', gap: 7, cursor: 'pointer',
    background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 999,
    padding: '5px 11px', fontSize: 12, color: 'var(--t1)', whiteSpace: 'nowrap' as const,
    fontWeight: (brand ? 800 : 600) as number, letterSpacing: brand ? '0.06em' : undefined,
  });
  const dd = {
    position: 'absolute' as const, top: 'calc(100% + 6px)', left: 0, zIndex: 200, minWidth: 246,
    background: 'var(--bg2)', border: '1px solid var(--bdh)', borderRadius: 10, padding: 5,
    boxShadow: '0 14px 34px rgba(0,0,0,.45)',
  };
  const ddHead  = { fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: '.07em', color: 'var(--t3)', padding: '6px 9px 3px' };
  const ddItem  = (on: boolean) => ({
    display: 'flex' as const, alignItems: 'center', gap: 9, width: '100%', textAlign: 'left' as const,
    border: 'none', background: on ? 'var(--bg3)' : 'transparent', color: 'var(--t1)',
    fontSize: 12.5, padding: '7px 9px', borderRadius: 6, cursor: 'pointer',
  });
  const ddSep   = { height: 1, background: 'var(--bd)', margin: '5px 3px' };
  const ddBadge = { marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 8, border: '1px solid var(--bd)', borderRadius: 999, padding: '1px 5px', color: 'var(--t3)' };
  const ddNote  = { fontSize: 9.5, color: 'var(--t3)', padding: '4px 9px 2px', lineHeight: 1.35 };
  const kbd     = { fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--t3)', border: '1px solid var(--bd)', borderRadius: 4, padding: '0 4px' };

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
        {/* ── Бренд = КНОПКА-dropdown, единственный вход в смену «мира».
            Логотип-ссылка ломала выравнивание и телепортировала пользователя. ── */}
        <div style={{ position: 'relative', flexShrink: 0 }} data-dd>
          <button
            type="button"
            aria-expanded={openDD === 'brand'}
            aria-haspopup="menu"
            title="LORE — пространства"
            onClick={() => setOpenDD(d => d === 'brand' ? null : 'brand')}
            style={pill(true)}
          >
            <span style={liveDot} />LORE<span style={caret}>⌄</span>
          </button>
          {openDD === 'brand' && (
            <div style={dd} role="menu">
              <div style={ddHead}>LORE · пространства</div>
              {SHELL_TABS.map(tab => {
                const on = tab.id === active;
                return (
                  <button key={tab.id} type="button" role="menuitem" style={ddItem(on)}
                    onClick={() => { setOpenDD(null); navigate(tab.to); }}>
                    <GameIcon slug={tab.icon} size={15} style={{ color: on ? 'var(--acc)' : 'var(--t2)', transform: tab.flipX ? 'scaleX(-1)' : undefined }} />
                    <span style={{ fontWeight: on ? 700 : 500, color: on ? 'var(--acc)' : 'var(--t1)' }}>{t(tab.labelKey, tab.fallback)}</span>
                    {on && <span style={ddBadge}>здесь</span>}
                  </button>
                );
              })}
              {/* Админка — gated-пункт в бренд-dropdown, не разбросанные кнопки (ADR-LORE-025) */}
              {isAdmin && (
                <>
                  <div style={ddSep} />
                  <div style={ddHead}>Переходы</div>
                  <button type="button" role="menuitem" style={ddItem(false)}
                    onClick={() => { setOpenDD(null); navigate('/lore?section=admin'); }}>
                    <span style={{ width: 15, textAlign: 'center' }}>⚙</span>
                    <span style={{ color: 'var(--wrn)' }}>{t('app.admin', 'Админка')}</span>
                    <span style={{ ...ddBadge, color: 'var(--dng)', borderColor: 'var(--dng)' }}>admin</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Тенант — самостоятельный контрол: контекст ДАННЫХ, а не «куда идём» ── */}
        {!narrow && (
          <div style={{ position: 'relative', flexShrink: 0 }} data-dd>
            <button type="button" aria-expanded={openDD === 'tenant'} aria-haspopup="menu"
              title="Рабочее пространство данных"
              onClick={() => setOpenDD(d => d === 'tenant' ? null : 'tenant')}
              style={pill(false)}>
              <span style={liveDot} />{tenant}<span style={caret}>⌄</span>
            </button>
            {openDD === 'tenant' && (
              <div style={dd} role="menu">
                <div style={ddHead}>Рабочее пространство (тенант)</div>
                {['DEFAULT', 'DEMO'].map(tn => (
                  <button key={tn} type="button" role="menuitem" style={ddItem(tn === tenant)}
                    onClick={() => { setTenant(tn); setOpenDD(null); }}>
                    <span style={{ width: 15, textAlign: 'center' }}>{tn === 'DEMO' ? '◐' : '◉'}</span>
                    <span style={{ fontWeight: tn === tenant ? 700 : 500 }}>{tn}</span>
                    {tn === tenant && <span style={ddBadge}>здесь</span>}
                  </button>
                ))}
                <div style={ddNote}>Тенант ⟂ навигация: смена пространства данных не меняет раздел — вы остаётесь там же.</div>
              </div>
            )}
          </div>
        )}

        <div style={{ width: 1, height: 20, background: 'var(--bd)', margin: '0 2px' }} />

        {/* Активное пространство (его модули — главы Storyline ниже, в LorePage) */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, fontWeight: 800, fontSize: 13, letterSpacing: '0.02em', color: 'var(--t1)' }}>
          {activeTab && <GameIcon slug={activeTab.icon} size={15} style={{ color: 'var(--acc)', transform: activeTab.flipX ? 'scaleX(-1)' : undefined }} />}
          {!narrow && activeTab && <span>{t(activeTab.labelKey, activeTab.fallback)}</span>}
        </div>

        <div style={{ flex: 1, minWidth: 0 }} />

        {/* ── Правый тулбар: только первичное (поиск · ещё · профиль) ── */}
        <button type="button" onClick={() => setPalOpen(true)}
          title="Поиск по данным (/)" aria-label="Поиск"
          style={{ ...btnStyle, textTransform: 'none' as const }}>
          ⌕{!narrow && <span style={{ ...kbd, marginLeft: 6 }}>/</span>}
        </button>

        <div style={{ position: 'relative', flexShrink: 0 }} data-dd>
          <button type="button" aria-expanded={openDD === 'more'} aria-haspopup="menu"
            title="Ещё — тема, палитра, язык"
            onClick={() => setOpenDD(d => d === 'more' ? null : 'more')} style={btnStyle}>⋯</button>
          {openDD === 'more' && (
            <div style={{ ...dd, left: 'auto', right: 0 }} role="menu">
              <div style={ddHead}>Вторичное</div>
              <button type="button" role="menuitem" style={ddItem(false)} onClick={togglePalette}>
                <span style={{ width: 15, textAlign: 'center' }}>{palette === 'amber' ? '◑' : '◐'}</span>
                Палитра: {palette}
              </button>
              <button type="button" role="menuitem" style={ddItem(false)} onClick={toggleMode}>
                <span style={{ width: 15, textAlign: 'center' }}>{mode === 'dark' ? '🌙' : '☀'}</span>
                {mode === 'dark' ? 'Тёмная тема' : 'Светлая тема'}
              </button>
              <button type="button" role="menuitem" style={ddItem(false)}
                onClick={() => { void i18n.changeLanguage(lang === 'ru' ? 'en' : 'ru'); setOpenDD(null); }}>
                <span style={{ width: 15, textAlign: 'center' }}>🌐</span>
                {lang === 'ru' ? 'Switch to English' : 'Переключить на русский'}
              </button>
              <div style={ddSep} />
              <button type="button" role="menuitem" style={ddItem(false)} onClick={() => { setOpenDD(null); setPalOpen(true); }}>
                <span style={{ width: 15, textAlign: 'center' }}>⌕</span>Поиск<span style={{ ...ddBadge, borderColor: 'var(--bd)' }}>/</span>
              </button>
            </div>
          )}
        </div>

        {/* A2: only rendered once VITE_LORE_AUTH_ENABLED is actually on. */}
        {AUTH_ENABLED ? (
          <button type="button" onClick={() => { void logout(); }} title="Выйти"
            style={{ ...btnStyle, textTransform: 'none' as const }}>
            {displayName() ?? '…'} ⏻
          </button>
        ) : (
          <div title="Профиль" aria-hidden
            style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--acc)', color: 'var(--bg0)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
            {(displayName() ?? 'АЛ').slice(0, 2).toUpperCase()}
          </div>
        )}
      </header>

      {/* ── Палитра поиска: модалка по «/» или кнопке (доменный поиск по данным) ── */}
      {palOpen && (
        <div
          onMouseDown={e => { if (e.target === e.currentTarget) setPalOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.48)', zIndex: 300, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '11vh' }}
        >
          <div style={{ width: 'min(560px, 92vw)', background: 'var(--bg2)', border: '1px solid var(--bdh)', borderRadius: 12, boxShadow: '0 22px 64px rgba(0,0,0,.55)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderBottom: '1px solid var(--bd)' }}>
              <span style={{ fontSize: 15 }}>⌕</span>
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--acc)', border: '1px solid var(--acc)', borderRadius: 999, padding: '1px 8px' }}>поиск по данным</span>
              <input
                autoFocus
                value={palQ}
                onChange={e => setPalQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitSearch(); }}
                placeholder="id, название сущности…"
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 15, color: 'var(--t1)' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 14, padding: '7px 13px', fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>
              <span>↵ искать</span><span>esc закрыть</span><span>«/» открыть</span>
            </div>
          </div>
        </div>
      )}

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
