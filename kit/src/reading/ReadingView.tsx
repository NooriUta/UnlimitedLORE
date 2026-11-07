// Режим чтения Seiðr-kit (SPRINT_UXR_S5_RECORD_TASKS/S5-05), по принципам
// редизайна п. 25, 30, 32 (doc lore_ux_redesign_principles_2026_11):
//
//   • текст — колонкой ~680 px (токен --read-col; 50–80 знаков, WCAG 1.4.8),
//     а таблицы, код и диаграммы (mermaid/bpmn) выходят шире колонки — до
//     --read-wide, но не за область чтения; широкая таблица прокручивается сама;
//   • ⤢ у каждого широкого блока — блок на весь экран (лист с копией);
//   • Aa — настройки чтения: размер текста (ступени --fs-*) и «сворачивать
//     меню при чтении»; всё запоминается;
//   • ушко правой колонки (свойства записи): по умолчанию колонка выключена и
//     запоминается (D-2026-UXR-RAIL-OFF); на узком экране — лист справа;
//   • меню оболочки при чтении сворачивается в ушко, если так в настройке
//     (умолчание — да, D-2026-UXR-READ-COLLAPSE); вышли из чтения — вернулось.
//
// Тело — любое (обычно MartProse): широкие блоки находятся в DOM после
// рендера и дорисовки (mermaid асинхронен) — MutationObserver, без своего
// разбора Markdown.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';
import type { KitKey } from '../i18n';
import { createSafeStorage } from '../resilience/safeStorage';
import type { SafeStorage } from '../resilience/safeStorage';
import { Ear } from '../shell/Ear';
import { useOptionalKitShell } from '../shell/KitShell';
import { Drawer, Sheet } from '../shell/Sheet';
import { READ_SIZES, readReadingPrefs, writeReadingPrefs } from './readingPrefs';
import type { ReadingPrefs } from './readingPrefs';

/** Что считается широким блоком: выходит за колонку и получает ⤢. */
export const WIDE_SELECTOR = 'table, pre, .sk-prose__diagram, .sk-prose__bpmn';

const SIZE_LABEL: Record<ReadingPrefs['size'], KitKey> = {
  s: 'kit.read.size.s', m: 'kit.read.size.m', l: 'kit.read.size.l', xl: 'kit.read.size.xl',
};

const NARROW_QUERY = '(max-width: 720px)';

/** Настройки чтения с записью в хранилище; правка — частичная. */
export function useReadingPrefs(storage: SafeStorage, storageKey: string): [ReadingPrefs, (patch: Partial<ReadingPrefs>) => void] {
  const [prefs, setPrefs] = useState<ReadingPrefs>(() => readReadingPrefs(storage, storageKey));
  const update = useCallback((patch: Partial<ReadingPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      writeReadingPrefs(storage, storageKey, next);
      return next;
    });
  }, [storage, storageKey]);
  return [prefs, update];
}

function useNarrow(force: boolean | undefined): boolean {
  const [matches, setMatches] = useState(() => {
    if (force !== undefined || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(NARROW_QUERY).matches;
  });
  useEffect(() => {
    if (force !== undefined || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(NARROW_QUERY);
    setMatches(mql.matches);
    const onChange = (e: { matches: boolean }) => setMatches(e.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [force]);
  return force ?? matches;
}

interface PrefsFormProps {
  prefs: ReadingPrefs;
  onChange: (patch: Partial<ReadingPrefs>) => void;
}

/** Форма настроек чтения: размер текста и «сворачивать меню». */
function ReadingPrefsForm({ prefs, onChange }: PrefsFormProps) {
  const lang = useKitLang();
  const name = useId();
  return (
    <>
      <div role="radiogroup" aria-label={kitT(lang, 'kit.read.size')} className="sk-read__sizes">
        {READ_SIZES.map(s => (
          <label key={s.id} className="sk-read__opt" data-size={s.id}>
            <input
              type="radio"
              name={name}
              value={s.id}
              checked={prefs.size === s.id}
              onChange={() => onChange({ size: s.id })}
            />
            <span>{kitT(lang, SIZE_LABEL[s.id])}</span>
          </label>
        ))}
      </div>
      <label className="sk-read__opt">
        <input
          type="checkbox"
          checked={prefs.collapseMenu}
          onChange={e => onChange({ collapseMenu: e.currentTarget.checked })}
        />
        <span>{kitT(lang, 'kit.read.collapseMenu')}</span>
      </label>
    </>
  );
}

export interface ReadingSettingsProps {
  storage?: SafeStorage;
  storageKey?: string;
}

/** Настройки чтения отдельным блоком — для страницы личных настроек. */
export function ReadingSettings({ storage: storageProp, storageKey = 'seidr-kit' }: ReadingSettingsProps) {
  const lang = useKitLang();
  const storage = useMemo(() => storageProp ?? createSafeStorage(), [storageProp]);
  const [prefs, update] = useReadingPrefs(storage, storageKey);
  return (
    <section className="sk-read__settings" aria-label={kitT(lang, 'kit.read.section')}>
      <ReadingPrefsForm prefs={prefs} onChange={update} />
    </section>
  );
}

/** Копия блока для «на весь экран»: без ⤢, служебных классов и дублей id вне SVG. */
function cloneForFull(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.classList.remove('sk-read__wide');
  copy.querySelectorAll('.sk-read__bar, .sk-prose__palette').forEach(n => n.remove());
  copy.querySelectorAll<HTMLElement>('[id]').forEach(n => { if (!n.closest('svg')) n.removeAttribute('id'); });
  if (copy.id) copy.removeAttribute('id');
  return copy;
}

export interface ReadingViewProps {
  /** Тело записи (обычно MartProse). */
  children: ReactNode;
  /** Правая колонка (свойства). Нет — нет и ушка. */
  rail?: ReactNode;
  /** Подпись ушка и колонки; по умолчанию «Свойства». */
  railLabel?: string;
  /** Кнопки слева от Aa (например, «‹ x из y ›» у задачи, S5-04). */
  toolbar?: ReactNode;
  /** Хранилище настроек; по умолчанию localStorage с откатом в память. */
  storage?: SafeStorage;
  /** Префикс ключа хранилища — у каждого приложения свой. */
  storageKey?: string;
  /** Принудительно узкий/широкий режим; не задан — по matchMedia. */
  narrow?: boolean;
  className?: string;
}

export function ReadingView({
  children, rail, railLabel, toolbar, storage: storageProp, storageKey = 'seidr-kit', narrow: narrowProp, className,
}: ReadingViewProps) {
  const lang = useKitLang();
  const storage = useMemo(() => storageProp ?? createSafeStorage(), [storageProp]);
  const [prefs, update] = useReadingPrefs(storage, storageKey);
  const narrow = useNarrow(narrowProp);
  const shell = useOptionalKitShell();
  const setMenuCollapsed = shell?.setMenuCollapsed;

  const panelId = useId();
  const railId = useId();
  const [panel, setPanel] = useState(false);
  const [railSheet, setRailSheet] = useState(false);
  const [full, setFull] = useState<HTMLElement | null>(null);
  const aaRef = useRef<HTMLButtonElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const expandLabel = kitT(lang, 'kit.read.expand');
  const railTitle = railLabel ?? kitT(lang, 'kit.read.rail');

  // Меню оболочки — по настройке; на выходе из чтения возвращаем.
  useEffect(() => {
    if (!setMenuCollapsed || !prefs.collapseMenu) return;
    setMenuCollapsed(true);
    return () => setMenuCollapsed(false);
  }, [setMenuCollapsed, prefs.collapseMenu]);

  // Широкие блоки: класс + строка с ⤢ перед блоком. Идемпотентно — наблюдатель
  // видит и свои вставки, но второй проход ничего не меняет.
  useLayoutEffect(() => {
    const col = colRef.current;
    if (!col) return;
    const owners = new WeakMap<HTMLElement, HTMLElement>();
    const decorate = () => {
      col.querySelectorAll<HTMLElement>('.sk-read__bar').forEach(bar => {
        const el = owners.get(bar);
        if (!el || !el.isConnected || bar.nextElementSibling !== el) bar.remove();
      });
      col.querySelectorAll<HTMLElement>(WIDE_SELECTOR).forEach(el => {
        if (el.classList.contains('sk-read__wide')) return;
        // вложенный в другой широкий блок или в плашку ошибки диаграммы — не отдельный блок
        const parent = el.parentElement;
        if (parent?.closest(`${WIDE_SELECTOR}, .sk-prose__diagram-err`)) return;
        el.classList.add('sk-read__wide');
        const bar = document.createElement('div');
        bar.className = 'sk-read__bar';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sk-read__expand';
        btn.setAttribute('aria-label', expandLabel);
        btn.title = expandLabel;
        btn.textContent = '⤢';
        btn.addEventListener('click', () => setFull(cloneForFull(el)));
        bar.appendChild(btn);
        owners.set(bar, el);
        el.parentNode?.insertBefore(bar, el);
      });
    };
    decorate();
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(decorate);
    mo.observe(col, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [expandLabel]);

  const closePanel = () => {
    setPanel(false);
    aaRef.current?.focus();
  };
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePanel();
    }
  };

  const railOpen = narrow ? railSheet : prefs.rail;
  const toggleRail = () => {
    if (narrow) setRailSheet(o => !o);
    else update({ rail: !prefs.rail });
  };

  return (
    <div
      className={['sk-read', rail && !narrow && prefs.rail ? 'sk-read--rail' : '', className].filter(Boolean).join(' ')}
      data-size={prefs.size}
    >
      <div className="sk-read__main">
        <div className="sk-read__tools">
          {toolbar}
          <button
            ref={aaRef}
            type="button"
            className="sk-read__aa"
            aria-label={kitT(lang, 'kit.read.settings')}
            title={kitT(lang, 'kit.read.settings')}
            aria-expanded={panel}
            aria-controls={panel ? panelId : undefined}
            onClick={() => setPanel(p => !p)}
          >Aa</button>
        </div>
        {panel && (
          <div
            id={panelId}
            role="group"
            aria-label={kitT(lang, 'kit.read.settings')}
            className="sk-read__panel"
            onKeyDown={onPanelKey}
          >
            <ReadingPrefsForm prefs={prefs} onChange={update} />
          </div>
        )}
        <div ref={colRef} className="sk-read__col">{children}</div>
      </div>
      {rail && (
        <div className="sk-read__side">
          <Ear
            side="right"
            label={railTitle}
            expanded={railOpen}
            controls={!narrow && railOpen ? railId : undefined}
            onToggle={toggleRail}
          />
          {!narrow && prefs.rail && (
            <aside id={railId} className="sk-read__rail" aria-label={railTitle}>{rail}</aside>
          )}
        </div>
      )}
      {rail && narrow && (
        <Drawer open={railSheet} onClose={() => setRailSheet(false)} title={railTitle}>{rail}</Drawer>
      )}
      <Sheet open={full !== null} onClose={() => setFull(null)} title={expandLabel} side="bottom" className="sk-read-full">
        <div
          className="sk-read__full-body"
          ref={node => { if (node && full && node.firstChild !== full) node.replaceChildren(full); }}
        />
      </Sheet>
    </div>
  );
}
