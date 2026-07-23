import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { GameIcon } from '../lore/GameIcon';
import { SHELL_TABS, type ShellTab } from './shellNav';
import { CHAPTERS, chapterOf, type Section } from './forsetiChapters';
import { useIsNarrow } from '../../hooks/useMediaQuery';
import { AUTH_ENABLED, displayName, getRole, logout, sessionExpiresAt } from '../../auth/session';
import { Modal } from '@mantine/core';
import { LoreSearchScreen } from '../lore/LoreSearchScreen';
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
  const { pathname, search } = useLocation();
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
  const [openDD, setOpenDD] = useState<null | 'brand' | 'tenant' | 'chapters' | 'more' | 'user'>(null);
  const [tenant, setTenant] = useState('DEFAULT');
  const [palOpen, setPalOpen] = useState(false);
  const [palQ, setPalQ] = useState('');
  // Время окончания сессии для меню профиля (AL-76). Считается на каждый рендер,
  // а не по таймеру: меню открывают редко, а лишний интервал пришлось бы гасить
  // при размонтировании — цена выше пользы. Пустая строка, когда auth выключен
  // или токена нет.
  const expiresAt = AUTH_ENABLED ? sessionExpiresAt() : null;
  const sessionLeft = expiresAt
    ? new Date(expiresAt * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : '';

  const activeTab = SHELL_TABS.find(x => x.id === active);
  // Модули активного пространства = главы Storyline (пока определены у Forseti).
  // Активная глава выводится из URL (?section=…), а не хранится в сторе.
  const curSection = ((new URLSearchParams(search).get('section')) as Section | null) ?? 'plan';
  const curChapter = chapterOf(curSection);
  const showModules = active === 'projects' && !narrow;
  // Главы уходят в меню ровно тогда, когда не помещаются строкой. Условие
  // ОДНО на оба варианта: разойдись они — на какой-то ширине главы пропали бы
  // и из строки, и из меню, и разделы стали бы недостижимы (так и было).
  const chaptersInMenu = active === 'projects' && narrow;

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

  // ── Поиск сведён в ОДНУ поверхность (ADR-LORE-033 D16/D17) ──────────────────
  //
  // Здесь больше нет ни запроса к API, ни списка результатов, ни выбора
  // стрелками: всё это делает LoreSearchScreen внутри модалки. Шапка только
  // ОТКРЫВАЕТ поиск и помнит, с каким запросом он открыт.
  //
  // Раньше палитра держала собственную выдачу (limit 12, без фасетов и ранга)
  // рядом с полноценным экраном. Две реализации одного поиска расходились бы
  // при первой же правке — и уже расходились: счётчик в палитре показывал
  // размер окна выдачи вместо числа найденного.

  const liveDot = { width: 7, height: 7, borderRadius: '50%', background: 'var(--suc)', flexShrink: 0, display: 'inline-block' as const };
  const caret   = { color: 'var(--t3)', fontSize: 'var(--fs-xs)' };
  // Пилюля тенанта — как «● DEFAULT ⌄» в эталоне: моноширинный капс с трекингом.
  const pill = (brand: boolean) => ({
    display: 'inline-flex' as const, alignItems: 'center', gap: 7, cursor: 'pointer',
    background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 7,
    padding: '5px 11px', fontSize: brand ? 12 : 11.5, color: 'var(--t1)', whiteSpace: 'nowrap' as const,
    fontFamily: brand ? undefined : 'var(--mono)',
    textTransform: (brand ? undefined : 'uppercase') as 'uppercase' | undefined,
    fontWeight: (brand ? 800 : 600) as number, letterSpacing: '0.06em',
  });
  const dd = {
    position: 'absolute' as const, top: 'calc(100% + 6px)', left: 0, zIndex: 200, minWidth: 246,
    background: 'var(--bg2)', border: '1px solid var(--bdh)', borderRadius: 10, padding: 5,
    boxShadow: '0 14px 34px rgba(0,0,0,.45)',
  };
  const ddHead  = { fontSize: 'var(--fs-2xs)', textTransform: 'uppercase' as const, letterSpacing: '.07em', color: 'var(--t3)', padding: '6px 9px 3px' };
  const ddItem  = (on: boolean) => ({
    display: 'flex' as const, alignItems: 'center', gap: 9, width: '100%', textAlign: 'left' as const,
    border: 'none', background: on ? 'var(--bg3)' : 'transparent', color: 'var(--t1)',
    fontSize: 12.5, padding: '7px 9px', borderRadius: 6, cursor: 'pointer',
  });
  const ddSep   = { height: 1, background: 'var(--bd)', margin: '5px 3px' };
  const ddBadge = { marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 8, border: '1px solid var(--bd)', borderRadius: 999, padding: '1px 5px', color: 'var(--t3)' };
  const ddNote  = { fontSize: 9.5, color: 'var(--t3)', padding: '4px 9px 2px', lineHeight: 1.35 };
  const kbd     = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)', border: '1px solid var(--bd)', borderRadius: 4, padding: '0 4px' };

  const btnStyle = {
    background: 'transparent',
    border: '1px solid var(--bd)',
    borderRadius: 'var(--seer-radius-sm, 4px)',
    cursor: 'pointer',
    color: 'var(--t2)',
    fontFamily: 'var(--mono)',
    fontSize: 'var(--fs-sm)',
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
            title={t('shell.brandTitle', 'LORE — пространства')}
            onClick={() => setOpenDD(d => d === 'brand' ? null : 'brand')}
            style={{
              // Бренд без окантовки — прежний вид логотипа (display-шрифт),
              // но поведение кнопки-dropdown (эталон Студии).
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: 'var(--t1)', fontFamily: 'var(--display)', fontSize: 18,
              fontWeight: 800, letterSpacing: '0.04em', lineHeight: 1,
            }}
          >
            LORE<span style={caret}>⌄</span>
          </button>
          {openDD === 'brand' && (
            <div style={dd} role="menu">
              <div style={ddHead}>{t('shell.spaces', 'LORE · пространства')}</div>
              {SHELL_TABS.map(tab => {
                const on = tab.id === active;
                return (
                  <button key={tab.id} type="button" role="menuitem" style={ddItem(on)}
                    onClick={() => { setOpenDD(null); navigate(tab.to); }}>
                    <GameIcon slug={tab.icon} size={15} style={{ color: on ? 'var(--acc)' : 'var(--t2)', transform: tab.flipX ? 'scaleX(-1)' : undefined }} />
                    <span style={{ fontWeight: on ? 700 : 500, color: on ? 'var(--acc)' : 'var(--t1)' }}>{t(tab.labelKey, tab.fallback)}</span>
                    {on && <span style={ddBadge}>{t('shell.here', 'здесь')}</span>}
                  </button>
                );
              })}
              {/* Админка — gated-пункт в бренд-dropdown, не разбросанные кнопки (ADR-LORE-025) */}
              {isAdmin && (
                <>
                  <div style={ddSep} />
                  <div style={ddHead}>{t('shell.transitions', 'Переходы')}</div>
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

        {!narrow && <div style={{ width: 1, height: 20, background: 'var(--bd)', margin: '0 2px', flexShrink: 0 }} />}

        {/* ── Тенант — самостоятельный контрол: контекст ДАННЫХ, а не «куда идём» ── */}
        {!narrow && (
          <div style={{ position: 'relative', flexShrink: 0 }} data-dd>
            <button type="button" aria-expanded={openDD === 'tenant'} aria-haspopup="menu"
              title={t('shell.tenantTitle', 'Рабочее пространство данных')}
              onClick={() => setOpenDD(d => d === 'tenant' ? null : 'tenant')}
              style={pill(false)}>
              <span style={liveDot} />{tenant}<span style={caret}>⌄</span>
            </button>
            {openDD === 'tenant' && (
              <div style={dd} role="menu">
                <div style={ddHead}>{t('shell.tenant', 'Рабочее пространство (тенант)')}</div>
                {['DEFAULT', 'DEMO'].map(tn => (
                  <button key={tn} type="button" role="menuitem" style={ddItem(tn === tenant)}
                    onClick={() => { setTenant(tn); setOpenDD(null); }}>
                    <span style={{ width: 15, textAlign: 'center' }}>{tn === 'DEMO' ? '◐' : '◉'}</span>
                    <span style={{ fontWeight: tn === tenant ? 700 : 500 }}>{tn}</span>
                    {tn === tenant && <span style={ddBadge}>{t('shell.here', 'здесь')}</span>}
                  </button>
                ))}
                <div style={ddNote}>Тенант ⟂ навигация: смена пространства данных не меняет раздел — вы остаётесь там же.</div>
              </div>
            )}
          </div>
        )}

        <div style={{ width: 1, height: 20, background: 'var(--bd)', margin: '0 2px' }} />

        {/* Активное пространство КАПСОМ + его модули (главы) инлайн — эталон Seiðr.
            На узком экране главы инлайн не помещаются (showModules=false), и
            раньше попасть в них было НЕЧЕМ: этот блок был просто подписью, а
            строка глав не рисовалась вовсе. Разделы «Зачем · Как делаем · Что
            решили · Основа · Контроль» становились недостижимы с телефона.
            Теперь на узком он — кнопка с тем же списком глав в выпадающем меню. */}
        {chaptersInMenu ? (
          <div style={{ position: 'relative', flexShrink: 0 }} data-dd>
            <button type="button"
              aria-haspopup="menu" aria-expanded={openDD === 'chapters'}
              aria-label={t('shell.chapters', 'Главы Forseti')}
              onClick={() => setOpenDD(d => d === 'chapters' ? null : 'chapters')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                background: 'none', border: 'none', padding: '2px 4px',
                fontFamily: 'inherit', fontWeight: 800, fontSize: 'var(--fs-md)',
                letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: 'var(--t1)',
              }}>
              {activeTab && <GameIcon slug={activeTab.icon} size={15} style={{ color: 'var(--acc)', transform: activeTab.flipX ? 'scaleX(-1)' : undefined }} />}
              <span style={caret}>⌄</span>
            </button>
            {openDD === 'chapters' && (
              <div role="menu" style={dd}>
                <div style={ddHead}>{t('shell.chapters', 'Главы Forseti')}</div>
                {CHAPTERS.map(c => {
                  const on = c.id === curChapter.id;
                  return (
                    <button key={c.id} type="button" role="menuitem" style={ddItem(on)}
                      onClick={() => { setOpenDD(null); navigate(`/lore?section=${c.sections[0]}`); }}>
                      <GameIcon slug={c.icon} size={15} style={{ color: on ? 'var(--acc)' : 'var(--t3)' }} />
                      <span style={{ fontWeight: on ? 700 : 500 }}>{t(c.nameKey, c.name)}</span>
                      {on && <span style={ddBadge}>{t('shell.here', 'здесь')}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, fontWeight: 800, fontSize: 'var(--fs-md)', letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: 'var(--t1)' }}>
            {activeTab && <GameIcon slug={activeTab.icon} size={15} style={{ color: 'var(--acc)', transform: activeTab.flipX ? 'scaleX(-1)' : undefined }} />}
            <span>{t(activeTab!.labelKey, activeTab!.fallback)}</span>
          </div>
        )}

        {showModules && <div style={{ width: 1, height: 20, background: 'var(--bd)', margin: '0 8px', flexShrink: 0 }} />}

        {showModules && (
          <nav className="lore-nav-scroll" role="tablist" aria-label={t('shell.chapters', 'Главы Forseti')}
            style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, overflowX: 'auto' }}>
            {CHAPTERS.map(c => {
              const on = c.id === curChapter.id;
              return (
                <button key={c.id} type="button" role="tab" aria-selected={on} title={t(c.qKey, c.q)}
                  onClick={() => navigate(`/lore?section=${c.sections[0]}`)}
                  style={{
                    // Активный модуль — оливковая рамка + подсветка, неактивные приглушены
                    // (эталон Seiðr: LOOM активен, KNOT тусклее, ANVIL почти невидим).
                    display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
                    border: `1px solid ${on ? 'color-mix(in srgb, var(--acc) 45%, var(--bd))' : 'transparent'}`,
                    background: on ? 'color-mix(in srgb, var(--acc) 10%, transparent)' : 'transparent',
                    color: on ? 'var(--t1)' : 'var(--t2)', fontSize: 12.5,
                    fontWeight: on ? 700 : 600, padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
                    transition: 'background 120ms, color 120ms, border-color 120ms',
                  }}
                  onMouseEnter={e => { if (!on) { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--t1)'; } }}
                  onMouseLeave={e => { if (!on) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t2)'; } }}>
                  <GameIcon slug={c.icon} size={15} style={{ color: on ? 'var(--acc)' : 'var(--t3)' }} />
                  {t(c.nameKey, c.name)}
                </button>
              );
            })}
          </nav>
        )}

        <div style={{ flex: 1, minWidth: 0 }} />

        {/* ── Правый тулбар: только первичное (поиск · ещё · профиль) ──
            Иконка — GameIcon, как у всех соседей по шапке. Здесь стоял глиф
            «⌕» (U+2315), которого НЕТ ни в Manrope, ни в IBM Plex Mono:
            браузер подставлял его из системного шрифта, поэтому вид зависел
            от ОС и не подчинялся нашей типографике вовсе. Замерено — ширина
            глифа одинакова во всех трёх наших шрифтах (23.1px), тогда как
            буква «M» даёт 33.6 / 24 / 22: верный признак чужого фолбэка. */}
        <button type="button" onClick={() => setPalOpen(true)}
          title={t('shell.searchTitle', 'Поиск по данным (/)')} aria-label={t('shell.searchAria', 'Поиск')}
          style={{ ...btnStyle, textTransform: 'none' as const, display: 'inline-flex', alignItems: 'center' }}>
          <GameIcon slug="magnifying-glass" size={15} style={{ color: 'inherit' }} />
          {!narrow && <span style={{ ...kbd, marginLeft: 6 }}>/</span>}
        </button>

        <div style={{ position: 'relative', flexShrink: 0 }} data-dd>
          <button type="button" aria-expanded={openDD === 'more'} aria-haspopup="menu"
            title={t('shell.moreTitle', 'Ещё — тема, палитра, язык')}
            onClick={() => setOpenDD(d => d === 'more' ? null : 'more')} style={btnStyle}>⋯</button>
          {openDD === 'more' && (
            <div style={{ ...dd, left: 'auto', right: 0 }} role="menu">
              <div style={ddHead}>{t('shell.secondary', 'Вторичное')}</div>
              <button type="button" role="menuitem" style={ddItem(false)} onClick={togglePalette}>
                <span style={{ width: 15, textAlign: 'center' }}>{palette === 'amber' ? '◑' : '◐'}</span>
                Палитра: {palette}
              </button>
              <button type="button" role="menuitem" style={ddItem(false)} onClick={toggleMode}>
                <span style={{ width: 15, textAlign: 'center' }}>{mode === 'dark' ? '🌙' : '☀'}</span>
                {mode === 'dark' ? t('shell.themeDark', 'Тёмная тема') : t('shell.themeLight', 'Светлая тема')}
              </button>
              <button type="button" role="menuitem" style={ddItem(false)}
                onClick={() => { void i18n.changeLanguage(lang === 'ru' ? 'en' : 'ru'); setOpenDD(null); }}>
                <span style={{ width: 15, textAlign: 'center' }}>🌐</span>
                {/* Намеренно НЕ через t(): переключатель показывает целевой язык
                    на нём самом. Пропустив через локализацию, мы бы предлагали
                    англоязычному «Переключить на русский» по-английски. */}
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
          // AL-76. Меню, а не кнопка-выход.
          //
          // Раньше элемент выглядел чипом профиля, а один клик по нему обрывал
          // сессию без подтверждения: соседние кнопки шапки открывают меню, эта
          // одна прекращала работу. Обещание расходилось с действием.
          //
          // Выигрыш не только в защите от промаха. Появилось место показать, чья
          // сессия и СКОЛЬКО ЕЙ ОСТАЛОСЬ — до этого об истечении узнавали только
          // по факту, уже будучи выброшенными, и вопрос «почему меня вдруг
          // выкинуло» возникал задним числом (прод-инцидент 2026-07-21).
          <div style={{ position: 'relative', flexShrink: 0 }} data-dd>
            <button type="button" aria-expanded={openDD === 'user'} aria-haspopup="menu"
              title={t('shell.profile', 'Профиль')}
              onClick={() => setOpenDD(d => d === 'user' ? null : 'user')}
              style={{ ...btnStyle, textTransform: 'none' as const }}>
              {displayName() ?? '…'} ▾
            </button>
            {openDD === 'user' && (
              <div style={{ ...dd, left: 'auto', right: 0, minWidth: 210 }} role="menu">
                <div style={ddHead}>{displayName() ?? '…'}</div>
                <div style={ddNote}>
                  {t('shell.role', 'роль')} {getRole()}
                  {sessionLeft && <> · {t('shell.sessionUntil', 'сессия до')} {sessionLeft}</>}
                </div>
                <div style={ddSep} />
                <button type="button" role="menuitem"
                  style={{ ...ddItem(false), color: 'var(--dng)' }}
                  onClick={() => { setOpenDD(null); void logout(); }}>
                  <span style={{ width: 15, textAlign: 'center' }}>⏻</span>
                  {t('shell.logout', 'Выйти')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div title={t('shell.profile', 'Профиль')} aria-hidden
            style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--acc)', color: 'var(--bg0)', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-xs)', fontWeight: 800, flexShrink: 0 }}>
            {(displayName() ?? 'АЛ').slice(0, 2).toUpperCase()}
          </div>
        )}
      </header>

      {/* ── Поиск: ЕДИНСТВЕННАЯ поверхность (ADR-LORE-033 D16/D17) ──────────
          Открывается лупой или «/». Внутри — тот же компонент, что раньше жил
          отдельным экраном: фасеты, разложенный ранг, разобранное выражение,
          баннер покрытия, пагинация. Держать рядом бедную палитру и богатый
          экран значило иметь две двери в одно место, неразличимые на вид.

          Mantine Modal, а не свой оверлей (ADR-LORE-034): focus trap, возврат
          фокуса на кнопку при закрытии, Escape, блокировка прокрутки фона и
          role="dialog" приходят готовыми. Прежний самодельный оверлей ничего
          из этого не делал — в проекте не было НИ ОДНОГО role="dialog". */}
      <Modal
        opened={palOpen}
        onClose={() => { setPalOpen(false); setPalQ(''); }}
        size="900px"
        title={t('shell.searchData', 'поиск по данным')}
        overlayProps={{ backgroundOpacity: 0.6, blur: 2 }}
        styles={{ body: { maxHeight: '78vh', overflowY: 'auto' } }}
      >
        {/* key монтирует поиск заново на каждое открытие: иначе он показывал бы
            выдачу прошлого запроса до первого ввода — то есть отвечал бы на
            вопрос, которого сейчас не задавали. */}
        {palOpen && (
          <LoreSearchScreen
            key={palQ ? 'seeded' : 'fresh'}
            autoFocus
            initialQuery={palQ}
            onNavigated={() => { setPalOpen(false); setPalQ(''); }}
          />
        )}
      </Modal>

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
                <span style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '0.02em', lineHeight: 1 }}>{t(tab.labelKey, tab.fallback)}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
