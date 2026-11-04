import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// Shared empty-state primitive (SPRINT_LORE_UX_OPTIMIZATION T19) — 20 list/
// detail components each had their own ad-hoc "nothing here" markup with
// slightly different padding/color/icon treatment. Not rolled out to all 20
// in one pass (real risk/diff-size tradeoff for a purely cosmetic change) —
// applied where a surface was already being touched; the rest are a tracked
// follow-up, not silently dropped.

export interface EmptyStateProps {
  message: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
}

export function EmptyState({ message, icon, hint }: EmptyStateProps) {
  return (
    <div style={{
      padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    }}>
      {icon}
      <span>{message}</span>
      {hint && <span style={{ fontSize: 'var(--fs-xs)' }}>{hint}</span>}
    </div>
  );
}

// AH-07: честное «не удалось загрузить» рядом с EmptyState. Сбой не рисуется как
// «пусто»: данные могут существовать — их не удалось получить.
export function LoadError({ text, onRetry, retryLabel }: { text: string; onRetry?: () => void; retryLabel?: ReactNode }) {
  return (
    <div role="alert" style={{
      padding: 24, color: 'var(--dng)', fontSize: 'var(--fs-base)', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', wordBreak: 'break-word' }}>{text}</span>
      {onRetry && (
        <button onClick={onRetry} style={{
          background: 'none', border: '1px solid var(--bd)', borderRadius: 999, color: 'var(--t2)',
          padding: '4px 12px', cursor: 'pointer', font: 'inherit', fontSize: 'var(--fs-xs)', minHeight: 28,
        }}>{retryLabel ?? '↻'}</button>
      )}
    </div>
  );
}

// AH-07 (зона 3): списки для выбора не загрузились — форма работает, но выбрать
// из них нельзя, и это должно быть видно. Пустой селект без пометки читается
// как «вариантов нет», хотя их просто не удалось получить.
export function PickerLoadWarning({ failed }: { failed: Record<string, string> }) {
  const { t } = useTranslation();
  const names = Object.keys(failed);
  if (names.length === 0) return null;
  return (
    <div role="alert" style={{
      margin: '6px 0', padding: '6px 10px', borderRadius: 4, fontSize: 'var(--fs-xs)', color: 'var(--wrn)',
      border: '1px solid color-mix(in srgb, var(--wrn) 40%, transparent)',
      background: 'color-mix(in srgb, var(--wrn) 8%, transparent)',
    }}>
      <div>{t('lore.pickerLoadFailed', 'Не загрузились списки для выбора: {{lists}}. Это сбой, а не пустота — выбрать из них сейчас нельзя, обновите позже.', { lists: names.join(', ') })}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)', wordBreak: 'break-word' }}>
        {names.map(n => `${n}: ${failed[n]}`).join(' · ')}
      </div>
    </div>
  );
}
