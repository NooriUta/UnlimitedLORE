import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ── Phase 2 — BENCHMARK tools (pending spec) ────────────────────────────────
// The UnlimitedLORE backend already serves the experiment mart and status:
//   GET /bench/mart/slices            — catalog (45 slices)
//   GET /bench/mart/slice/{id}        — rows for a named RAGVSDL slice
//   GET /bench/api/status             — live STATUS.json
// Read-only wrappers (bench_list_slices / bench_query_slice / bench_status)
// mirror loreRead.ts; write tools await the user's bench spec. Wire them up
// here and call registerBench() from index.ts when the spec lands.

export function registerBench(_server: McpServer): void {
  // intentionally empty until the bench spec is provided
}
