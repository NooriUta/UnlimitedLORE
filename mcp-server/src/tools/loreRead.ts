import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loreSlice, loreSlices } from '../backend.js';

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${(e as Error).message ?? String(e)}` }],
  isError: true,
});

export function registerLoreRead(server: McpServer): void {
  server.tool(
    'lore_list_slices',
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
    'lore_query_slice',
    'Run a named LORE read slice against system_aida_lore and return its rows. ' +
      'Examples: slice="sprints" (Gantt bars), "adrs", "adr" with ' +
      'params {"id":"ADR-FE-001"}, "spec_by_id" with params {"id":"..."}, ' +
      '"search" with params {"pattern":"..."}. Use lore_list_slices for the full ' +
      'catalog and each slice\'s required params.',
    {
      slice: z.string().describe('slice id from lore_list_slices, e.g. "sprints"'),
      params: z
        .record(z.string())
        .optional()
        .describe('slice parameters as string key/values, e.g. {"id":"ADR-FE-001"}'),
    },
    async ({ slice, params }) => {
      try {
        return json(await loreSlice(slice, params));
      } catch (e) {
        return err(e);
      }
    },
  );
}
