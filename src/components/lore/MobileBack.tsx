import { useTranslation } from 'react-i18next';

// AH-08: кнопка «← назад» узкого экрана — одна на все master-detail экраны,
// тот же вид, что в MasterDetail (product/shared.tsx).
export function MobileBack({ onBack, label }: { onBack: () => void; label?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onBack}
      style={{
        alignSelf: 'flex-start', margin: '6px 9px', padding: '6px 12px', minHeight: 36,
        fontSize: 'var(--fs-sm)', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
        background: 'transparent', border: '1px solid var(--bd)', color: 'var(--t2)', fontFamily: 'inherit',
      }}
    >
      ← {label ?? t('lore.mobile.back', 'назад')}
    </button>
  );
}
