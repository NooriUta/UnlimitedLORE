import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ACTIVE_PROJECT, loreSlice, loreSlices } from '../backend.js';

// ADR-LORE-017 (T16): Tier 1 — slices with a direct project relationship (today: sprints,
// via BELONGS_TO_PROJECT — see LoreSlices.java's "sprints" optionalFilters). Extend this set
// as more slices grow a `project` optional filter; Tier 2 (Task/Component/ADR/tech-registry)
// deliberately never gets one (cross-project by design, see the ADR).
const PROJECT_SCOPED_SLICES = new Set(['sprints']);

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${(e as Error).message ?? String(e)}` }],
  isError: true,
});

export function registerLoreRead(server: McpServer): void {
  server.tool(
    'list_slices',
    'List all available LORE read slices (≈43) with their required and optional ' +
      'parameters. Call this first to discover what can be queried (plan, sprints, ' +
      'ADRs, decisions, releases, components, specs, docs, findings, …).',
    {},
    async () => {
      try {
        return json(await loreSlices());
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'query_slice',
    'Run a named LORE read slice against system_aida_lore and return its rows. ' +
      'Examples: slice="sprints" (Gantt bars), "adrs", "adr" with ' +
      'params {"id":"ADR-FE-001"}, "spec_by_id" with params {"id":"..."}, ' +
      '"search" with params {"pattern":"..."}. Use list_slices for the full ' +
      'catalog and each slice\'s required params. ' +
      'ADR-LORE-017: project-scoped slices (currently "sprints") accept an optional ' +
      '`project` param (git_project slug) — omit it to fall back to the session\'s ' +
      'LORE_ACTIVE_PROJECT default, if set; passing one that differs from that default ' +
      'is allowed but the response carries a `_warning` field so the mismatch is never silent.',
    {
      slice: z.string().describe('slice id from list_slices, e.g. "sprints"'),
      params: z
        .record(z.string(), z.string())
        .optional()
        .describe('slice parameters as string key/values, e.g. {"id":"ADR-FE-001"}'),
    },
    async ({ slice, params }) => {
      try {
        const effectiveParams = { ...(params ?? {}) };
        let warning: string | undefined;
        if (PROJECT_SCOPED_SLICES.has(slice) && ACTIVE_PROJECT) {
          if (effectiveParams.project === undefined) {
            effectiveParams.project = ACTIVE_PROJECT;
          } else if (effectiveParams.project !== ACTIVE_PROJECT) {
            warning = `project="${effectiveParams.project}" differs from the session's active project ` +
              `("${ACTIVE_PROJECT}", from LORE_ACTIVE_PROJECT) — proceeding with the explicit value.`;
          }
        }
        const rows = await loreSlice(slice, Object.keys(effectiveParams).length ? effectiveParams : undefined);
        return json(warning ? { rows, _warning: warning } : rows);
      } catch (e) {
        return err(e);
      }
    },
  );
}
