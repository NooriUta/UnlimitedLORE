// Parses QualityGate.content_md per ADR-QG-002 INV-block format + ADR-QG-004 data contract.
// Shared by LoreQGDetail.tsx (per-gate report) and LoreAnalytics.tsx (fleet rollup) —
// content_md is the single source of truth for routine name, direction, target, condition.

export interface ParsedInv {
  invNo: string;       // "01"
  key: string;         // bare metric_key, e.g. "auth_timeout_ms"
  unit: string | null;
  target: number | null;
  direction: string | null;   // gte | lte
  source: string | null;
  howToVerify: string | null;
  condition: string | null;
  descr: string | null;
}

export function parseRoutine(md: string | null, fallback: string): string {
  if (!md) return fallback;
  const m = md.match(/\*\*Routine:\*\*\s*`([^`]+)`/);
  return m ? m[1].trim() : fallback;
}

export function parseGateSubtitle(md: string | null): string | null {
  if (!md) return null;
  const m = md.match(/\*\*Gate:\*\*\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

export function parseInvariants(md: string | null): ParsedInv[] {
  if (!md) return [];
  const out: ParsedInv[] = [];
  // Split on "### " headings; first chunk is title/intro.
  const chunks = md.split(/^###\s+/m).slice(1);
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const head = lines[0] ?? '';
    // "INV-01 · circuit_breaker_fires"
    const hm = head.match(/INV-(\d+)\s*[·.\-]\s*([A-Za-z0-9_]+)/);
    if (!hm) continue;
    const invNo = hm[1];
    const key = hm[2].trim();
    // fenced block fields
    const fence = chunk.match(/```([\s\S]*?)```/);
    const block = fence ? fence[1] : '';
    const field = (name: string): string | null => {
      const r = block.match(new RegExp('^\\s*' + name + ':\\s*(.+)$', 'm'));
      return r ? r[1].trim() : null;
    };
    const tRaw = field('target');
    const target = tRaw != null && tRaw !== '' && !isNaN(Number(tRaw)) ? Number(tRaw) : null;
    // description: text after the closing fence, up to the next section boundary.
    // content_md often has trailing document sections after the last INV block
    // (e.g. a "Phase 2" invariants table, a compute_status appendix) that use `---`
    // or `## ` headings rather than `### INV-`, so they aren't split out by the
    // chunking above — without this cutoff they'd bleed into the last invariant's
    // description as one unformatted blob.
    let descr: string | null = null;
    if (fence) {
      let after = chunk.slice((chunk.indexOf(fence[0]) ?? 0) + fence[0].length);
      const boundary = after.search(/\n\s*(---|##\s)/);
      if (boundary !== -1) after = after.slice(0, boundary);
      after = after.trim();
      descr = after ? after.split('\n').map(s => s.trim()).filter(Boolean).join(' ') : null;
    }
    out.push({
      invNo,
      key,
      unit: field('unit'),
      target,
      direction: field('direction'),
      source: field('source'),
      howToVerify: field('how_to_verify'),
      condition: field('condition'),
      descr,
    });
  }
  return out;
}

// ADR-QG-002 compute_status — same rule as backend, mirrored client-side for fleet-level
// aggregation (Analytics rollup) where we join content_md target/direction with live metric value.
export function computeStatus(value: number | null | undefined, target: number | null, direction: string | null): string {
  if (value == null || value === -1) return 'SKIP';
  if (target == null || !direction) return 'PASS';
  if (direction === 'gte') return value >= target ? 'PASS' : value >= target * 0.9 ? 'WARN' : 'FAIL';
  if (direction === 'lte') return value <= target ? 'PASS' : value <= target * 1.1 ? 'WARN' : 'FAIL';
  return value === target ? 'PASS' : 'FAIL';
}
