import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { muninnSlices, muninnSlice, muninnStatus } from '../backend.js';

// ── MUNINN (Исследования) read tools ─────────────────────────────────────────
// Read-only access to the RAG-vs-Parse experiment mart (RAGVSDL) via the
// UnlimitedLORE backend (:9100). The mart is written exclusively by the Python
// engine (rag-vs-parse/scripts/mart.py) — these tools never write.

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${(e as Error).message ?? String(e)}` }],
  isError: true,
});

export function registerMuninn(server: McpServer): void {
  server.tool(
    'bench_list_slices',
    'List all available BENCHMARK (RAG-vs-Parse) experiment-mart slices with ' +
      'their required and optional parameters. Call this first to discover what ' +
      'can be queried (campaigns, hypotheses, findings, runs, trace, substrates, ' +
      'references, biblio, …).',
    {},
    async () => {
      try {
        return json(await muninnSlices());
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'bench_query_slice',
    'Run a named experiment-mart slice against RAGVSDL and return its rows. ' +
      'Examples: slice="hypotheses", "findings", "runs", "substrates", or ' +
      '"trace" with params {"run":"…","case_id":"…","substrate":"…"}. Use ' +
      'bench_list_slices for the full catalog and each slice\'s required params.',
    {
      slice: z.string().describe('slice id from bench_list_slices, e.g. "findings"'),
      params: z
        .record(z.string())
        .optional()
        .describe('slice parameters as string key/values, e.g. {"run":"…"}'),
    },
    async ({ slice, params }) => {
      try {
        return json(await muninnSlice(slice, params));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'bench_status',
    'Live status of the running experiment cell (results/STATUS.json): manifest, ' +
      'done/total, current step, errors, elapsed_min, updated. Empty when no run ' +
      'is active.',
    {},
    async () => {
      try {
        return json(await muninnStatus());
      } catch (e) {
        return err(e);
      }
    },
  );
}
