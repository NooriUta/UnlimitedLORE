// Status → game-icon slug + colour, for LORE status ticks and chips.
// Colours reuse the app's semantic design tokens (tokens.css), so they adapt to
// both the theme (dark/light) AND the active palette (lichen/slate/juniper/…)
// automatically — no hard-coded hex. Icons are game-icons, bundled offline via
// addCollection in main.tsx (air-gap safe, ADR-FE-001).

import { dictColor, dictIcon } from './DictionaryProvider';

export interface StatusMeta { icon: string; color: string }

const STATUS_META: Record<string, StatusMeta> = {
  // done / closed family → success green
  done:        { icon: 'divided-spiral',  color: 'var(--suc)' },
  fixed:       { icon: 'divided-spiral',  color: 'var(--suc)' },
  reached:     { icon: 'divided-spiral',  color: 'var(--suc)' },
  accepted:    { icon: 'laurel-crown',    color: 'var(--suc)' },
  // in-progress family → info teal
  active:      { icon: 'progression',    color: 'var(--inf)' },
  in_progress: { icon: 'progression',    color: 'var(--inf)' },
  upcoming:    { icon: 'progression',    color: 'var(--inf)' },
  // planned / priority family → warning amber
  planned:     { icon: 'calendar',       color: 'var(--wrn)' },
  proposed:    { icon: 'calendar',       color: 'var(--wrn)' },
  high:        { icon: 'dice-fire',      color: 'var(--wrn)' },
  // partially done — distinct from active → warning amber
  partial:          { icon: 'battery-50',    color: 'var(--wrn)' },
  // ready for deploy — work done, waiting for release
  ready_for_deploy: { icon: 'wave-crest',    color: 'var(--inf)' },
  // blocked / rejected family → danger red
  blocked:     { icon: 'handcuffed',     color: 'var(--dng)' },
  rejected:    { icon: 'crossed-sabres', color: 'var(--dng)' },
  missed:      { icon: 'crossed-sabres', color: 'var(--dng)' },
  // design / backlog / neutral family → muted/amber
  design:      { icon: 'magic-swirl',    color: 'var(--wrn)' },
  backlog:     { icon: 'tied-scroll',    color: 'var(--t3)' },
  todo:        { icon: 'checkbox-tree',  color: 'var(--t3)' },
  deferred:    { icon: 'pause-button',   color: 'var(--t3)' },
  superseded:  { icon: 'pause-button',   color: 'var(--t3)' },
  // cancelled — task explicitly removed from scope
  cancelled:   { icon: 'cross-mark',     color: 'var(--t3)' },
};

const FALLBACK: StatusMeta = { icon: 'checkbox-tree', color: 'var(--t3)' };

// AL-28 (ADR-LORE-012): словарь — канон, карта выше — фолбэк (загрузка / старый
// бэкенд без слайса). Статусы живут в трёх dict_type, ключ у всех — тот же код.
// До этого правка цвета статуса в Admin LORE не меняла в UI ничего: словарь
// показывался, а рисовалось из STATUS_META.
const STATUS_DICTS = ['task_status', 'sprint_status', 'adr_status'];
function fromDict(code: string): StatusMeta | undefined {
  for (const d of STATUS_DICTS) {
    const color = dictColor(d, code), icon = dictIcon(d, code);
    if (color || icon) {
      const base = STATUS_META[code] ?? FALLBACK;
      return { icon: icon ?? base.icon, color: color ?? base.color };
    }
  }
  return undefined;
}

export function statusMeta(status: string | null | undefined): StatusMeta {
  const code = (status ?? '').toLowerCase();
  return fromDict(code) ?? STATUS_META[code] ?? FALLBACK;
}

/**
 * Resolve status meta from EITHER a clean key ("accepted", "active") OR a raw
 * marker line ("✅ DONE", "🟡 PARTIAL"). Plain keys hit STATUS_META directly;
 * emoji/prefix-marked raw statuses are normalized via {@link taskTick} first.
 * Avoids the silent FALLBACK (checkbox-tree) when given an emoji-prefixed status.
 */
export function resolveStatusMeta(status: string | null | undefined): StatusMeta {
  const code = (status ?? '').toLowerCase().trim();
  const direct = fromDict(code) ?? STATUS_META[code];
  if (direct) return direct;
  const norm = taskTick(status).status;
  return fromDict(norm) ?? STATUS_META[norm] ?? FALLBACK;
}

/**
 * Display label for a status chip: strips a leading emoji/marker so the chip's
 * game-icon isn't duplicated by an inline emoji ("✅ DONE" → "DONE"). Clean keys
 * pass through unchanged ("accepted" → "accepted").
 */
export function statusLabel(status: string | null | undefined): string {
  const raw = (status ?? '').trim();
  const stripped = raw.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return stripped || raw;
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
  if (s.startsWith('🚀') || /^(READY.?FOR.?DEPLOY|RFD|К.?ДЕПЛОЮ)/i.test(s)) return { status: 'ready_for_deploy', done: false };
  if (s.startsWith('🔴') || /^(BLOCK|ЗАБЛОК)/i.test(s)) return { status: 'blocked', done: false };
  if (s.startsWith('🚫') || /^(CANCEL|ОТМЕН)/i.test(s)) return { status: 'cancelled', done: false };
  if (s.startsWith('🔬') || /^(DESIGN|ДИЗАЙН|ПРОЕКТ)/i.test(s)) return { status: 'design', done: false };
  if (s.startsWith('🟣') || /^(BACKLOG|БЭКЛОГ|БЭКЛ)/i.test(s)) return { status: 'backlog', done: false };
  if (s.startsWith('📋') || /^(PLANNED|ЗАПЛАН|ПЛАН)/i.test(s)) return { status: 'planned', done: false };
  if (s.startsWith('⏸') || /^(CONDITION|HOLD|PAUSE|ON.?HOLD|DEFER|ОТЛОЖЕН|УСЛОВН|ПАУ)/i.test(s)) return { status: 'deferred', done: false };
  // ⬜ is the canonical "todo" marker on the backend (SCD2_STATUS_RAW), not deferred.
  if (s.startsWith('⬜') || /^(TODO|TO.?DO|НЕ.?НАЧАТ)/i.test(s)) return { status: 'todo', done: false };
  return { status: 'todo', done: false };
}
