import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// Unified filter/search primitives (SPRINT_LORE_UX_OPTIMIZATION T31/T32).
// Approved design: docs/prototypes/two-tier-filter.html — one toggle per
// FilterBar (no per-dimension folding), collapsed = one-line summary
// (FilterSummaryLine, horizontally scrollable, never wraps), expanded =
// full picker. Facet counts (T33) are passed in by the caller, not computed
// here — these components stay presentational/controlled.

// ---- Chip -------------------------------------------------------------

export interface ChipProps {
  label: ReactNode;
  pressed: boolean;
  onClick: () => void;
  /** Facet count for this option; omit to skip the count badge entirely (no zero-dimming either). */
  count?: number;
  /** Accent color for the pressed state / dot (defaults to var(--acc)). */
  color?: string;
  /** Small color dot before the label — used for component/project/area/status chips. */
  dot?: boolean;
  /** 'pill' (fully round, default — multi-select/bool/preset) or 'rounded' (6px — single-select). */
  shape?: 'pill' | 'rounded';
}

export function Chip({ label, pressed, onClick, count, color, dot, shape = 'pill' }: ChipProps) {
  const c = color ?? 'var(--acc)';
  const zero = count === 0 && !pressed;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={zero}
      onClick={onClick}
      style={{
        font: 'inherit', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 8px', borderRadius: shape === 'pill' ? 999 : 6, cursor: zero ? 'default' : 'pointer',
        border: `1px solid ${pressed ? `color-mix(in srgb, ${c} 60%, var(--bd))` : 'var(--b3)'}`,
        background: pressed ? `color-mix(in srgb, ${c} 16%, transparent)` : 'transparent',
        color: pressed ? 'var(--t1)' : 'var(--t3)',
        whiteSpace: 'nowrap', opacity: zero ? 0.32 : 1, pointerEvents: zero ? 'none' : 'auto',
      }}
    >
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: pressed ? c : 'var(--t3)' }} />}
      {label}
      {count !== undefined && <span style={{ fontSize: 9.5, opacity: 0.65, fontFamily: 'var(--mono)' }}>{count}</span>}
    </button>
  );
}

// ---- SearchInput --------------------------------------------------------

export interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  maxWidth?: number;
}

export function SearchInput({ value, onChange, placeholder, ariaLabel, maxWidth = 320 }: SearchInputProps) {
  const { t } = useTranslation();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px',
      border: '1px solid var(--b3)', borderRadius: 8, background: 'var(--bg2)', maxWidth,
    }}>
      <span style={{ color: 'var(--t3)' }}>🔍</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? t('lore.filters.search', 'Поиск')}
        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: 13, fontFamily: 'inherit' }}
      />
      {value && (
        <button
          type="button"
          aria-label={t('lore.filters.clearSearch', 'Очистить поиск')}
          onClick={() => onChange('')}
          style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer' }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ---- FilterTag / FilterSummaryLine ---------------------------------------

export interface FilterTagData {
  key: string;
  label: ReactNode;
  onRemove: () => void;
  color?: string;
  /** Dashed/dimmed — persisted global value that doesn't apply on the current surface ("н/д"). */
  muted?: boolean;
}

export function FilterTag({ label, onRemove, color, muted }: FilterTagData) {
  const c = color ?? 'var(--acc)';
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onRemove(); }}
      style={{
        font: 'inherit', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 8px', borderRadius: 999, cursor: 'pointer', background: 'var(--bg2)',
        border: `1px solid color-mix(in srgb, ${c} 45%, var(--bd))`, borderStyle: muted ? 'dashed' : 'solid',
        color: 'var(--t1)', whiteSpace: 'nowrap', flexShrink: 0, opacity: muted ? 0.5 : 1,
      }}
    >
      {label} <span style={{ color: 'var(--t3)' }}>✕</span>
    </button>
  );
}

export interface FilterSummaryLineProps {
  tags: FilterTagData[];
  emptyLabel?: string;
}

/**
 * The "one line for reading" row — never wraps, scrolls horizontally if it
 * overflows. aria-live="polite": this is the ONLY persistent feedback that a
 * filter was toggled (the chip that changed lives inside the collapsed band,
 * invisible to screen readers), so announce it here — generalizes the old
 * narrow-only active-filters strip's aria-live to every viewport (T19).
 */
export function FilterSummaryLine({ tags, emptyLabel }: FilterSummaryLineProps) {
  const { t } = useTranslation();
  if (!tags.length) {
    return (
      <span aria-live="polite" style={{ color: 'var(--t3)', fontSize: 11, whiteSpace: 'nowrap' }}>
        {emptyLabel ?? t('lore.filters.notSet', 'не заданы')}
      </span>
    );
  }
  return (
    <div aria-live="polite" style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', flex: 1, minWidth: 0, scrollbarWidth: 'none' }}>
      {tags.map(({ key, ...tag }) => <FilterTag key={key} {...tag} />)}
    </div>
  );
}

// ---- SortControl ----------------------------------------------------------

export interface SortOption { key: string; label: string }

export interface SortControlProps {
  options: SortOption[];
  sortKey: string;
  direction: 'asc' | 'desc';
  onChange: (key: string, direction: 'asc' | 'desc') => void;
}

export function SortControl({ options, sortKey, direction, onChange }: SortControlProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => {
        const active = o.key === sortKey;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key, active ? (direction === 'asc' ? 'desc' : 'asc') : 'desc')}
            style={{
              font: 'inherit', fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${active ? 'color-mix(in srgb, var(--acc) 55%, var(--bd))' : 'var(--b3)'}`,
              background: active ? 'color-mix(in srgb, var(--acc) 12%, transparent)' : 'transparent',
              color: active ? 'var(--acc)' : 'var(--t3)', display: 'inline-flex', gap: 4, alignItems: 'center',
            }}
          >
            {o.label}{active && <span style={{ fontSize: 9 }}>{direction === 'asc' ? '↑' : '↓'}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---- FilterDimension (label + chip row) helpers ---------------------------

export interface FilterOption { value: string; label: string; color?: string }

export interface FilterDimensionMultiProps {
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  counts?: Record<string, number>;
  dot?: boolean;
}

export function FilterDimensionMulti({ label, options, selected, onToggle, counts, dot }: FilterDimensionMultiProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span style={dimLabelStyle}>{label}</span>
      {options.map(o => (
        <Chip key={o.value} label={o.label} pressed={selected.has(o.value)} onClick={() => onToggle(o.value)}
          count={counts?.[o.value]} color={o.color} dot={dot} />
      ))}
    </div>
  );
}

export interface FilterDimensionSingleProps {
  label: string;
  options: FilterOption[];
  selected: string | null;
  /** Re-selecting the active option clears it (passes null). */
  onSelect: (value: string | null) => void;
  counts?: Record<string, number>;
}

export function FilterDimensionSingle({ label, options, selected, onSelect, counts }: FilterDimensionSingleProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span style={dimLabelStyle}>{label}</span>
      {options.map(o => (
        <Chip key={o.value} label={o.label} shape="rounded" pressed={selected === o.value}
          onClick={() => onSelect(selected === o.value ? null : o.value)} count={counts?.[o.value]} />
      ))}
    </div>
  );
}

const dimLabelStyle = {
  fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.05em', textTransform: 'uppercase' as const,
  color: 'var(--t3)', width: 82, flexShrink: 0,
};

// ---- FilterBar --------------------------------------------------------------

export interface FilterBarProps {
  tier: 'global' | 'local';
  label: string;
  activeCount: number;
  summaryTags: FilterTagData[];
  onClear?: () => void;
  open: boolean;
  onToggleOpen: () => void;
  /** Sticky under the section nav — used for tier="global" on pages with a fixed top bar. */
  sticky?: boolean;
  stickyTop?: number;
  children: ReactNode;
}

/**
 * One filter tier as a single collapsible band. Collapsed (default) = one
 * summary line (name · count · active values, each removable via its own ✕
 * · clear · toggle) — the whole band opens/closes as one unit, never
 * per-dimension (tried and rejected — too noisy, see [[feedback_ux_change_process]]).
 */
export function FilterBar({ tier, label, activeCount, summaryTags, onClear, open, onToggleOpen, sticky, stickyTop = 0, children }: FilterBarProps) {
  const { t } = useTranslation();
  const isGlobal = tier === 'global';
  return (
    <div style={{
      position: sticky ? 'sticky' : undefined, top: sticky ? stickyTop : undefined, zIndex: sticky ? 2 : undefined,
      background: isGlobal ? 'color-mix(in srgb, var(--acc) 7%, var(--bg1))' : 'var(--bg1)',
      borderBottom: '1px solid var(--bd)',
    }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggleOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleOpen(); } }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', cursor: 'pointer', minWidth: 0 }}
      >
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase',
          color: isGlobal ? 'var(--acc)' : 'var(--t3)', flexShrink: 0,
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t2)', background: 'var(--bg2)',
          border: '1px solid var(--b3)', borderRadius: 999, padding: '0 7px', flexShrink: 0,
        }}>
          {activeCount}
        </span>
        <FilterSummaryLine tags={summaryTags} />
        {activeCount > 0 && onClear && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onClear(); }}
            style={{ flexShrink: 0, fontSize: 10.5, color: 'var(--t3)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {t('lore.filters.clear', '✕ сброс')}
          </button>
        )}
        <span style={{ flexShrink: 0, color: 'var(--t3)', fontSize: 11, whiteSpace: 'nowrap' }}>
          {open ? t('lore.filters.collapse', '▴ свернуть') : t('lore.filters.expand', '▾ развернуть')}
        </span>
      </div>
      {open && <div style={{ padding: isGlobal ? '0 14px 10px' : '0 12px 9px' }}>{children}</div>}
    </div>
  );
}
