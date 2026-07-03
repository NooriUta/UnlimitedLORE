// effort_days is fractional, granular to the hour (1 day = 8 working hours —
// smallest meaningful increment 0.125). Bare "0.125d" reads poorly for small
// tasks, so render sub-day amounts in hours and mixed amounts as "Xд Yч".
export function formatEffortDays(days: number): string {
  const totalHours = Math.round(days * 8);
  if (totalHours === 0) return '0ч';
  if (totalHours < 8) return `${totalHours}ч`;
  const d = Math.floor(totalHours / 8);
  const h = totalHours % 8;
  return h === 0 ? `${d}д` : `${d}д ${h}ч`;
}

export function parsePrRefs(s: string | string[] | null | undefined): string[] {
  if (!s) return [];
  const parts = Array.isArray(s) ? s : [s];
  const result: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') continue;
    // Markdown links: [#439](url) or [439](url) — common when pr_refs stored as MD text
    const mdMatches = part.match(/\[#?(\d+)\]\([^)]*\)/g);
    if (mdMatches) {
      for (const m of mdMatches) {
        const num = m.match(/\[#?(\d+)\]/);
        if (num) result.push(num[1]);
      }
    } else {
      // Fallback: comma/space separated plain numbers or bare #NNN
      for (const tok of part.split(/[\s,]+/)) {
        const n = tok.replace(/^#/, '').trim();
        if (/^\d+$/.test(n)) result.push(n);
      }
    }
  }
  return result;
}

// Normalize sprint/task status by LEADING marker, so a "DONE" mentioned later
// in the line (e.g. "⬜ TODO — (V1 ✅ DONE 2026-05-04)") does not flip status.
export function normalizeStatus(raw: string | null): string {
  if (!raw) return '';
  const s = raw.trimStart();
  if (s.startsWith('✅') || /^(DONE|CLOSED|ЗАВЕРШ|MERGED|ЗАКРЫТ)/i.test(s)) return 'done';
  if (s.startsWith('🔄') || s.startsWith('🟢') || s.startsWith('🔨') ||
      /^(IN.?PROGRESS|WIP|ACTIVE|READY|ОТКРЫТ)/i.test(s)) return 'in_progress';
  if (s.startsWith('🟡') || /^(PARTIAL|ЧАСТИЧ)/i.test(s)) return 'partial';
  if (s.startsWith('🟣') || /BACKLOG/i.test(s.slice(0, 15))) return 'backlog';
  if (s.startsWith('📋') || s.startsWith('⏳') || /^(PLANNED|STUB|DRAFT|PENDING)/i.test(s)) return 'planned';
  if (s.startsWith('⬜') && /^(DEFERRED|ARCHIVED)/i.test(s.slice(2).trimStart())) return 'deferred';
  if (s.startsWith('⬜') || /^TODO/i.test(s)) return 'todo';
  if (s.startsWith('🚀') || /^(READY.?FOR.?DEPLOY|RFD)/i.test(s)) return 'ready_for_deploy';
  if (s.startsWith('🔴') || /^BLOCKED/i.test(s)) return 'blocked';
  if (s.startsWith('⏸') || /^(DEFERRED|ARCHIVED)/i.test(s)) return 'deferred';
  if (s.startsWith('🔬') || /^(DESIGN|DESIGNING|RESEARCH|ИССЛЕДОВАН)/i.test(s)) return 'design';
  if (s.startsWith('🚫') || /^(CANCEL|ОТМЕН)/i.test(s)) return 'cancelled';
  return '';
}
