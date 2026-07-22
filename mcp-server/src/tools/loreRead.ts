import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ACTIVE_PROJECT, loreGet, loreSlice, loreSlices } from '../backend.js';

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

  // SRCH-07 (ADR-LORE-033): агент ищет ТЕМ ЖЕ эндпоинтом, что UI — ранжирование,
  // сниппеты и фасеты одинаковы для человека и машины. До этого агенты ходили
  // через query_slice('search') и получали плоский список без релевантности —
  // худший поиск, чем в интерфейсе.

  server.tool(
    'search',
    'Cross-entity ranked search over the whole LORE corpus (GET /lore/search, ADR-LORE-033). ' +
      'Finds by Russian morphology (запрос «релиз» находит «релиза»), prefix-as-you-type and ' +
      'body text (*Hist rows collapse to their parent entity). Returns {hits[], by_type, ' +
      'by_component, took_ms}; each hit carries type, ref_id, title, score, snippet, ' +
      'matched_field, components (inherited_from marks parent-derived links) and projects. ' +
      'Facets: types/components are CSV filters applied INSIDE each search branch, not as a ' +
      'post-filter. Prefer this over query_slice("search") — the slice is a flat unranked ' +
      'palette list kept for legacy consumers.',
    {
      q: z.string().min(2).max(160).describe('plain words; Lucene syntax is built server-side, metacharacters are stripped'),
      types: z.string().optional().describe('CSV type filter, e.g. "adr,task,question"'),
      components: z.string().optional().describe('CSV component filter, e.g. "FORSETI,OMILORE" — matches direct AND parent-inherited links'),
      projects: z.string().optional().describe('CSV of git-project slugs; multi-valued since SRCH-10 — a scalar could not express «two products out of five»'),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
      mode: z.enum(['smart', 'exact', 'fuzzy']).optional()
        .describe('smart (default): AND tokens + prefix on last; exact: whole phrase; fuzzy: ~ on words ≥5 chars'),
    },
    async ({ q, types, components, projects, limit, offset, mode }) => {
      try {
        const params: Record<string, string> = { q };
        if (types) params.types = types;
        if (components) params.components = components;
        if (projects) params.projects = projects;
        if (limit !== undefined) params.limit = String(limit);
        if (offset !== undefined) params.offset = String(offset);
        if (mode) params.mode = mode;
        return json(await loreGet('/lore/search', params));
      } catch (e) {
        return err(e);
      }
    },
  );

  // SRCH-06: «похожие записи» — вход ИДЕНТИФИКАТОР, не строка запроса.
  server.tool(
    'search_similar',
    'Find records textually similar to a given one (SEARCH_INDEX_MORE). Input is an ID, not a query string. ' +
      'TWO MEASURED ENGINE LIMITS, both reported in the response rather than hidden: (1) same_type_only — ' +
      'similarity never crosses types, a rid of one type against another type index returns nothing; ' +
      '(2) ranked:false — the engine returns $similarity = 1.0 for every row, so the order is NOT a relevance ' +
      'ranking and must not be presented as one. An EMPTY result is valid, not an error: Lucene MoreLikeThis ' +
      'has term/document frequency thresholds and filters everything out on small corpora.',
    {
      ref: z.string().describe('entity id, e.g. "ADR-LORE-022" or "UC-GIT-MERGE"'),
      limit: z.number().int().min(1).max(50).optional().describe('upper bound, not a promise (default 10)'),
    },
    async ({ ref, limit }) => {
      try {
        const params: Record<string, string> = { ref };
        if (limit !== undefined) params.limit = String(limit);
        return json(await loreGet('/lore/search/similar', params));
      } catch (e) {
        return err(e);
      }
    },
  );

}
