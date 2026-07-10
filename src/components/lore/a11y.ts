import type { KeyboardEvent } from 'react';

// Keyboard/role props for elements that must stay <span>/<div> (inline-styled
// chips, rows) but act as buttons (SPRINT_LORE_UX_OPTIMIZATION T11, finding
// A11Y-1). Spread onto the element instead of a bare onClick so the control is
// focusable and activates on Enter/Space — without restyling.
//   <span {...a11yClick(() => toggle(x))} style={...}>…</span>
export function a11yClick(onClick: () => void, label?: string) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    },
    ...(label ? { 'aria-label': label } : {}),
  } as const;
}
