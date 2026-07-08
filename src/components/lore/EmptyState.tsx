import type { ReactNode } from 'react';

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
