import { useTranslation } from 'react-i18next';

// SPRINT_UXR_S1_HONEST_API/S1-05 (B-04): тело скрыто правами — это не «Контент
// пуст». Документ может быть написан; читателю не хватает роли в его проекте.
export function RedactedBody({ reason }: { reason: string | null }) {
  const { t } = useTranslation();
  return (
    <div role="note" style={{
      margin: '6px 0', padding: '10px 12px', borderRadius: 4, fontSize: 'var(--fs-base)', color: 'var(--wrn)',
      border: '1px solid color-mix(in srgb, var(--wrn) 40%, transparent)',
      background: 'color-mix(in srgb, var(--wrn) 8%, transparent)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span>{t('lore.bodyRedacted.title')}</span>
      {reason && (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)', wordBreak: 'break-word' }}>
          {reason}
        </span>
      )}
    </div>
  );
}
