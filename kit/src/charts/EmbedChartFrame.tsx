// Рамка встроенного графика (SPRINT_VIZ_EMBED/EMB-L2, VE-4) — перенос v1
// src/components/lore/VolvaEmbedFrame.tsx в kit для v2.
//
// Честные состояния вместо пустой рамки («не смогли проверить» ≠ «пусто»):
// загрузка · не настроено (и что настроить — словами приложения) · недоступна ·
// нет прав · нужен выбор (например, проект) · график. Kit не ходит в сеть:
// подписанный адрес и состояние даёт приложение (K-14).
//
// Рамка: sandbox без навигации верхнего окна и попапов, без referrer. Высота —
// по сообщению metabase.frame только от СВОЕГО фрейма и только с origin
// подписанного адреса (отправитель шлёт на "*"). Сообщений во фрейм kit не
// шлёт; тема — через #hash адреса, при смене темы страницы адрес
// перестраивается (у апстрима нет сообщения для темы).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EmptyState, Forbidden, LoadError, NotBuilt, Skeleton } from '../states/StateViews';
import { kitT, useKitLang } from '../i18n';
import { embedOrigin, embedSrc, embedThemeOfDocument, frameHeightFromMessage, type EmbedTheme } from './embedFrame';

export type EmbedFrameState =
  | { kind: 'loading' }
  | { kind: 'ready'; signedUrl: string }
  /** Встраивание не настроено: hint — что настроить, detail — код ответа. */
  | { kind: 'not_configured'; hint?: ReactNode; detail?: string }
  /** Адрес не получен (сбой, сеть, не JSON) — встройка недоступна. */
  | { kind: 'unavailable'; detail?: string }
  | { kind: 'forbidden'; reason?: string }
  /** Показать нечего, пока человек не сделает выбор (слова — приложения). */
  | { kind: 'needs'; title: string; hint?: ReactNode };

export interface EmbedChartFrameProps {
  state: EmbedFrameState;
  /** Имя встраиваемой системы для текстов состояний («Völva»). */
  source: string;
  /** Подпись рамки для чтения с экрана. */
  title: string;
  minHeight?: number;
  /** Открытый параметр карточки (см. embedSrc); undefined — не трогать. */
  products?: string[];
  onRetry?: () => void;
  className?: string;
}

export function EmbedChartFrame({ state, source, title, minHeight = 240, products, onRetry, className }: EmbedChartFrameProps) {
  const lang = useKitLang();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const [theme, setTheme] = useState<EmbedTheme>(embedThemeOfDocument);
  const themeKey = `${theme.palette}/${theme.mode}`;

  // Тема страницы меняется атрибутами на <html> — перечитываем.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const mo = new MutationObserver(() => setTheme(embedThemeOfDocument()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-theme'] });
    return () => mo.disconnect();
  }, []);

  const signedUrl = state.kind === 'ready' ? state.signedUrl : null;
  const origin = useMemo(() => (signedUrl ? embedOrigin(signedUrl) : null), [signedUrl]);
  const productKey = products ? products.join(',') : '\u0000';
  const src = useMemo(
    () => (signedUrl && origin ? embedSrc(signedUrl, theme, { locale: lang, products }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signedUrl, origin, themeKey, productKey, lang],
  );

  useEffect(() => {
    if (!origin) return;
    const onMessage = (e: MessageEvent) => {
      // Только наш фрейм и только origin подписанного адреса: отправитель шлёт на "*".
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const h = frameHeightFromMessage({ origin: e.origin, data: e.data }, origin);
      if (h !== null) setHeight(Math.max(minHeight, h));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, minHeight]);

  const wrap = (kind: string, body: ReactNode) => (
    <div className={['sk-embed', className].filter(Boolean).join(' ')} data-embed-state={kind}>{body}</div>
  );

  switch (state.kind) {
    case 'loading':
      return wrap('loading', <Skeleton lines={4} label={kitT(lang, 'kit.embed.loading', { source })} />);
    case 'not_configured':
      return wrap('not_configured', (
        <NotBuilt
          title={kitT(lang, 'kit.embed.notConfigured', { source })}
          hint={<>{state.hint ?? kitT(lang, 'kit.embed.notConfiguredHint')}{state.detail ? <> <code className="sk-embed__code">{state.detail}</code></> : null}</>}
        />
      ));
    case 'forbidden':
      return wrap('forbidden', <Forbidden title={kitT(lang, 'kit.embed.forbidden')} reason={state.reason} />);
    case 'needs':
      return wrap('needs', <EmptyState title={state.title} hint={state.hint ?? ''} />);
    case 'unavailable':
      return wrap('unavailable', (
        <LoadError title={kitT(lang, 'kit.embed.unavailable', { source })} hint={kitT(lang, 'kit.embed.unavailableHint')}
          error={state.detail ? new Error(state.detail) : undefined} onRetry={onRetry} />
      ));
    case 'ready':
      if (!src) {
        return wrap('unavailable', (
          <LoadError title={kitT(lang, 'kit.embed.unavailable', { source })} hint={kitT(lang, 'kit.embed.badUrl')} onRetry={onRetry} />
        ));
      }
      return wrap('ready', (
        <iframe
          ref={frameRef}
          key={src}
          src={src}
          title={title}
          className="sk-embed__frame"
          // Скриптам встройки нужен свой origin; навигация верхнего окна и попапы — нет.
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          style={{ height: `${height}px` }}
        />
      ));
  }
}
