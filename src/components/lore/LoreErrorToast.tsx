import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

// AH-07: ошибка, которая не заменяет страницу (403/409/500 на загрузке или
// сохранении), обязана быть видна. До этого LorePage.handleFetchError её глушил,
// и неудачное сохранение выглядело как удачное. Стили — общий .toast из tokens.css.
export function LoreErrorToast({ text, onClose }: { text: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!text) return;
    const h = setTimeout(onClose, 10000);
    return () => clearTimeout(h);
  }, [text, onClose]);
  if (!text) return null;
  return (
    <div role="alert" className="toast err visible" style={{ pointerEvents: 'auto', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span>
        <b>{t('lore.errorToast.title')}</b>{' '}
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', wordBreak: 'break-word' }}>{text}</span>
      </span>
      <button onClick={onClose} aria-label={t('lore.errorToast.close')}
        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit', minWidth: 24, minHeight: 24 }}>✕</button>
    </div>
  );
}
