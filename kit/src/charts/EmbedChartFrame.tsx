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
import { embedOrigin, embedSrc, embedThemeOfDocument, frameErrorFromMessage, frameHeightFromMessage, type EmbedErrorCode, type EmbedTheme } from './embedFrame';

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
  /**
   * Сколько ждать первого metabase.frame от встройки, мс (живая встройка шлёт его каждые 100 мс,
   * VE-5). Не пришло — «не ответила» с «Повторить», а не страница браузера в рамке. 0 — не ждать.
   */
  answerTimeoutMs?: number;
  className?: string;
}

export function EmbedChartFrame({ state, source, title, minHeight = 240, products, onRetry, answerTimeoutMs = 15000, className }: EmbedChartFrameProps) {
  const lang = useKitLang();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const [theme, setTheme] = useState<EmbedTheme>(embedThemeOfDocument);
  const themeKey = `${theme.palette}/${theme.mode}`;
  // Приёмка 14.11.2026: хост встройки не отвечает — своё состояние, а не страница браузера.
  const [answered, setAnswered] = useState(false);
  const [silent, setSilent] = useState(false);
  // VE-7: встройка сообщила об ошибке (FORBIDDEN / NOT_FOUND / QUERY_FAILED) — своё состояние.
  const [embedError, setEmbedError] = useState<EmbedErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);

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
      const msg = { origin: e.origin, data: e.data };
      const h = frameHeightFromMessage(msg, origin);
      if (h !== null) { setAnswered(true); setHeight(Math.max(minHeight, h)); return; }
      const err = frameErrorFromMessage(msg, origin);
      if (err !== null) { setAnswered(true); setEmbedError(err); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, minHeight]);

  // Новый адрес или повтор — ждём ответа заново.
  useEffect(() => {
    setAnswered(false);
    setSilent(false);
    setEmbedError(null);
  }, [src, attempt]);
  useEffect(() => {
    if (!src || answered || answerTimeoutMs <= 0) return;
    const t = setTimeout(() => setSilent(true), answerTimeoutMs);
    return () => clearTimeout(t);
  }, [src, answered, answerTimeoutMs, attempt]);

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
      if (embedError === 'FORBIDDEN') {
        return wrap('forbidden', <Forbidden title={kitT(lang, 'kit.embed.forbidden')} reason={kitT(lang, 'kit.embed.errorForbiddenHint', { source })} />);
      }
      if (embedError) {
        const hintKey = embedError === 'NOT_FOUND' ? 'kit.embed.errorNotFoundHint'
          : embedError === 'QUERY_FAILED' ? 'kit.embed.errorQueryFailedHint' : 'kit.embed.errorUnknownHint';
        return wrap('embed_error', (
          <LoadError title={kitT(lang, 'kit.embed.error', { source })}
            hint={<>{kitT(lang, hintKey, { source })} <code className="sk-embed__code">{embedError}</code></>}
            onRetry={() => { setAttempt(n => n + 1); onRetry?.(); }} />
        ));
      }
      if (silent) {
        return wrap('silent', (
          <LoadError title={kitT(lang, 'kit.embed.silent', { source })}
            hint={kitT(lang, 'kit.embed.silentHint', { source, s: Math.round(answerTimeoutMs / 1000) })}
            onRetry={() => { setAttempt(n => n + 1); onRetry?.(); }} />
        ));
      }
      return wrap('ready', (
        <iframe
          ref={frameRef}
          key={`${src}#${attempt}`}
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
