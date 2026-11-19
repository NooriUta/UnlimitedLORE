// LangTabs — тексты на нескольких языках (SPRINT_LORE_MODEL_AS_CONFIG/MC-06).
//
// Язык без перевода помечен на самой вкладке — точкой И словами в имени вкладки: пустой перевод
// показывается языком по умолчанию, и это должно быть видно до того, как вкладку открыли.
// Какие языки и что считать «нет перевода», решает приложение; элемент — только форма (K-14).
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';

export interface LangTab {
  id: string;
  label: string;
  /** Перевод не заполнен (хотя бы один текст). */
  missing?: boolean;
}

export interface LangTabsProps {
  langs: readonly LangTab[];
  value: string;
  onChange: (id: string) => void;
  /** Имя группы вкладок. */
  label: string;
  /** Ключ локализации текстов — подписью под панелью. */
  i18nKey?: string;
  children?: ReactNode;
  className?: string;
}

export function LangTabs({ langs, value, onChange, label, i18nKey, children, className }: LangTabsProps) {
  const lang = useKitLang();
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = langs.findIndex(l => l.id === value);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = langs[(i + step + langs.length) % langs.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div className={['sk-langtabs', className].filter(Boolean).join(' ')}>
      <div role="tablist" aria-label={label} className="sk-langtabs__list">
        {langs.map(l => (
          <button
            key={l.id}
            ref={el => { refs.current[l.id] = el; }}
            type="button"
            role="tab"
            id={`${base}-${l.id}`}
            aria-selected={l.id === value}
            aria-controls={`${base}-panel`}
            aria-label={l.missing ? `${l.label} — ${kitT(lang, 'kit.lang.missing')}` : l.label}
            tabIndex={l.id === value ? 0 : -1}
            className="sk-langtabs__tab"
            data-missing={l.missing ? '' : undefined}
            onClick={() => onChange(l.id)}
            onKeyDown={onKey}
          >
            {l.label}{l.missing && <span className="sk-langtabs__miss" aria-hidden="true" title={kitT(lang, 'kit.lang.missing')}>•</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${value}`} className="sk-langtabs__panel">
        {children}
      </div>
      {i18nKey && <div className="sk-langtabs__key">{kitT(lang, 'kit.lang.key')} <code>{i18nKey}</code></div>}
    </div>
  );
}
