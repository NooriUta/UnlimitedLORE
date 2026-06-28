export function parsePrRefs(s: string | string[] | null | undefined): string[] {
  if (!s) return [];
  const parts = Array.isArray(s) ? s : [s];
  return parts
    .filter((x): x is string => typeof x === 'string')
    .flatMap(x => x.split(','))
    .map(x => x.trim())
    .filter(Boolean);
}

// Normalize sprint/task status by LEADING marker, so a "DONE" mentioned later
// in the line (e.g. "⬜ TODO — (V1 ✅ DONE 2026-05-04)") does not flip status.
export function normalizeStatus(raw: string | null): string {
  if (!raw) return '';
  const s = raw.trimStart();
  if (s.startsWith('✅') || /^(DONE|CLOSED|ЗАВЕРШ|MERGED|ЗАКРЫТ)/i.test(s)) return 'done';
  if (s.startsWith('🔄') || s.startsWith('🟢') ||
      /^(IN.?PROGRESS|WIP|ACTIVE|READY)/i.test(s)) return 'in_progress';
  if (s.startsWith('🟡') || /^(PARTIAL|ЧАСТИЧ)/i.test(s)) return 'partial';
  if (s.startsWith('📋') || s.startsWith('⬜') || /^(TODO|PLANNED|STUB|DRAFT)/i.test(s)) return 'planned';
  if (s.startsWith('🟣') || s.startsWith('⏸') || s.startsWith('⬜ DEFERRED') ||
      /^(BACKLOG|DEFERRED|BLOCKED|ARCHIVED)/i.test(s)) return 'deferred';
  if (s.startsWith('🚫') || /^(CANCEL|ОТМЕН)/i.test(s)) return 'cancelled';
  return '';
}
