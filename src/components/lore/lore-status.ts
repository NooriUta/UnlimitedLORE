// Status → game-icon slug + colour, for LORE status ticks and chips.
// Colours reuse the app's semantic design tokens (tokens.css), so they adapt to
// both the theme (dark/light) AND the active palette (lichen/slate/juniper/…)
// automatically — no hard-coded hex. Icons are game-icons, bundled offline via
// addCollection in main.tsx (air-gap safe, ADR-FE-001).

export interface StatusMeta { icon: string; color: string }

const STATUS_META: Record<string, StatusMeta> = {
  // done / closed family → success green
  done:        { icon: 'check-mark',     color: 'var(--suc)' },
  fixed:       { icon: 'check-mark',     color: 'var(--suc)' },
  reached:     { icon: 'check-mark',     color: 'var(--suc)' },
  accepted:    { icon: 'laurel-crown',   color: 'var(--suc)' },
  // in-progress family → info teal
  active:      { icon: 'progression',    color: 'var(--inf)' },
  in_progress: { icon: 'progression',    color: 'var(--inf)' },
  upcoming:    { icon: 'progression',    color: 'var(--inf)' },
  // planned / priority family → warning amber
  planned:     { icon: 'calendar',       color: 'var(--wrn)' },
  proposed:    { icon: 'calendar',       color: 'var(--wrn)' },
  high:        { icon: 'dice-fire',      color: 'var(--wrn)' },
  // partially done — distinct from active (🟡 marker, half-battery) → warning amber
  partial:     { icon: 'battery-50',     color: 'var(--wrn)' },
  // blocked / rejected family → danger red
  blocked:     { icon: 'padlock',        color: 'var(--danger)' },
  rejected:    { icon: 'crossed-sabres', color: 'var(--danger)' },
  missed:      { icon: 'crossed-sabres', color: 'var(--danger)' },
  // neutral / paused family → muted text
  todo:        { icon: 'checkbox-tree',  color: 'var(--t3)' },
  deferred:    { icon: 'pause-button',   color: 'var(--t3)' },
  superseded:  { icon: 'pause-button',   color: 'var(--t3)' },
  // cancelled — task explicitly removed from scope
  cancelled:   { icon: 'cancel',         color: 'var(--t3)' },
};

const FALLBACK: StatusMeta = { icon: 'checkbox-tree', color: 'var(--t3)' };

export function statusMeta(status: string | null | undefined): StatusMeta {
  return STATUS_META[(status ?? '').toLowerCase()] ?? FALLBACK;
}

/**
 * Task status tick from raw status_raw text. Prefix/leading-marker match so a marker
 * mentioned later in the line doesn't flip the result. Returns the normalized status key
 * (consumable by {@link statusMeta}) plus a done flag.
 */
export function taskTick(statusRaw: string | null | undefined): { status: string; done: boolean } {
  const s = (statusRaw ?? '').trimStart();
  if (s.startsWith('✅') || /^(DONE|CLOSED|ЗАВЕРШ)/i.test(s)) return { status: 'done', done: true };
  if (s.startsWith('🔄') || /^(IN.?PROGRESS|WIP|ACTIVE)/i.test(s))
    return { status: 'active', done: false };
  if (s.startsWith('🟡') || /^(PARTIAL|ЧАСТИЧ)/i.test(s)) return { status: 'partial', done: false };
  if (s.startsWith('🔴') || /^(BLOCK|ЗАБЛОК)/i.test(s)) return { status: 'blocked', done: false };
  if (s.startsWith('🚫') || /^(CANCEL|ОТМЕН)/i.test(s)) return { status: 'cancelled', done: false };
  return { status: 'todo', done: false };
}
