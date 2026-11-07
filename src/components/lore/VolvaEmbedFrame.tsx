// SPRINT_VIZ_EMBED/EMB-L2 — рамка встроенного графика Völva.
//
// Честные состояния вместо пустой рамки («не смогли проверить» ≠ «пусто»):
// не настроено (адреса нет) · ошибка подписи/доступа · загрузка · график.
// Высота — по сообщению встройки (только с origin подписанного адреса), тема —
// через #hash адреса; при смене темы LORE адрес перестраивается и фрейм
// перезагружается (отдельного сообщения для темы у Metabase нет).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { embedOrigin, embedSrc, frameHeightFromMessage, themeForHost, type EmbedTheme } from './volvaEmbed';

export type VolvaEmbedState =
  | { kind: 'ready'; signedUrl: string }
  | { kind: 'loading' }
  | { kind: 'not_configured' }
  | { kind: 'error'; message: string };

interface Props {
  state: VolvaEmbedState;
  title: string;
  minHeight?: number;
  /** Открытый параметр product карточки (сужение картинки, не граница прав). */
  products?: string[];
}

export default function VolvaEmbedFrame({ state, title, minHeight = 240, products }: Props) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const [theme, setTheme] = useState<EmbedTheme>(themeForHost);
  const themeKey = `${theme.palette}/${theme.mode}`;

  // Тема LORE меняется атрибутом на <html> — перечитываем.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => setTheme(themeForHost()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-theme'] });
    return () => mo.disconnect();
  }, []);

  const signedUrl = state.kind === 'ready' ? state.signedUrl : null;
  const origin = useMemo(() => (signedUrl ? embedOrigin(signedUrl) : null), [signedUrl]);
  const productKey = products ? products.join(',') : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const src = useMemo(() => (signedUrl ? embedSrc(signedUrl, theme, products) : null), [signedUrl, themeKey, productKey]);

  useEffect(() => {
    if (!origin) return;
    const onMessage = (e: MessageEvent) => {
      // Только наш фрейм и только origin подписанного адреса: отправитель шлёт на "*".
      if (e.source !== frameRef.current?.contentWindow) return;
      const h = frameHeightFromMessage({ origin: e.origin, data: e.data }, origin);
      if (h !== null) setHeight(Math.max(minHeight, h));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, minHeight]);

  if (state.kind === 'not_configured') {
    return <div style={S.note}>{t('lore.embed.notConfigured')}</div>;
  }
  if (state.kind === 'error') {
    return <div style={{ ...S.note, color: 'var(--dng)' }}>{t('lore.embed.error', { message: state.message })}</div>;
  }
  if (state.kind === 'loading' || !src) {
    return <div style={S.note}>{t('lore.embed.loading')}</div>;
  }
  return (
    <iframe
      ref={frameRef}
      key={src}
      src={src}
      title={title}
      // Скрипты встройки нужны; навигация верхнего окна и попапы — нет.
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      style={{ width: '100%', height, border: 0, background: 'transparent', display: 'block' }}
    />
  );
}

const S: Record<string, React.CSSProperties> = {
  note: {
    fontSize: 'var(--fs-sm)', color: 'var(--t3)', padding: '12px 14px',
    border: '1px dashed var(--bd)', borderRadius: 8, background: 'var(--b2)',
  },
};
