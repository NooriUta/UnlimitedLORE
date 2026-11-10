import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ACTIVE_PROJECT, loreGet, loreSliceWithMeta, loreSlices } from '../backend.js';
import { completeness, parseLoreQueryBlock } from './runBlock.js';

// ADR-LORE-017 (T16): slices that take a `project` param inherit LORE_ACTIVE_PROJECT
// when the caller omits it. Tier 2 (Task/Component/ADR/tech-registry) deliberately
// never grows one — cross-project by design, see the ADR.
//
// RM-P8: the set is DERIVED from the backend registry, not hand-maintained here.
// It used to be a literal `new Set(['sprints'])` with a comment saying "extend this
// as more slices grow a project filter" — and by the time anyone looked, the backend
// had six such slices and this file still had one. A hand-copied list is a second
// source of truth, and the corpus already pays for that mistake elsewhere (the
// PROJECT_SCOPED read-scope table, the twice-declared git_projects slice).
//
// Note these are two DIFFERENT things that only sound alike: LoreSlices.PROJECT_SCOPED
// is the RBAC read-scope (who may see what), while this is the convenience default
// (which project to assume when the caller names none). Merging them would be wrong.
let projectAwareSlices: Set<string> | undefined;
let projectAwareFailure: string | undefined;

/**
 * Does this slice take a `project` param? `undefined` = could not find out.
 *
 * The three answers stay distinct on purpose. "No" and "could not ask" would
 * otherwise both silently mean "no default applied", and an unscoped answer
 * would look exactly like a correctly scoped one.
 */
async function sliceTakesProject(slice: string): Promise<boolean | undefined> {
  if (!projectAwareSlices && !projectAwareFailure) {
    try {
      const payload = (await loreSlices()) as {
        slices?: Array<{ id: string; required?: string[]; optional?: string[] }>;
      };
      projectAwareSlices = new Set(
        (payload.slices ?? [])
          .filter((s) => [...(s.required ?? []), ...(s.optional ?? [])].includes('project'))
          .map((s) => s.id),
      );
    } catch (e) {
      projectAwareFailure = (e as Error).message ?? String(e);
    }
  }
  return projectAwareSlices ? projectAwareSlices.has(slice) : undefined;
}

/**
 * ADR-LORE-017: подстановка LORE_ACTIVE_PROJECT в срез с параметром project —
 * общая для query_slice и run_block, чтобы оба сужали одинаково и одинаково
 * говорили об этом.
 */
async function withProjectDefault(
  slice: string,
  params: Record<string, string> | undefined,
): Promise<{ effectiveParams: Record<string, string>; warning?: string; defaulted: boolean }> {
  const effectiveParams = { ...(params ?? {}) };
  let warning: string | undefined;
  let defaulted = false;
  if (ACTIVE_PROJECT) {
    const takesProject = await sliceTakesProject(slice);
    if (takesProject === undefined) {
      warning = `LORE_ACTIVE_PROJECT="${ACTIVE_PROJECT}" was NOT applied: the slice registry ` +
        `could not be read (${projectAwareFailure}). These rows are NOT limited to that project.`;
    } else if (takesProject && effectiveParams.project === undefined) {
      effectiveParams.project = ACTIVE_PROJECT;
      defaulted = true;
    } else if (takesProject && effectiveParams.project !== ACTIVE_PROJECT) {
      warning = `project="${effectiveParams.project}" differs from the session's active project ` +
        `("${ACTIVE_PROJECT}", from LORE_ACTIVE_PROJECT) — proceeding with the explicit value.`;
    }
  }
  return { effectiveParams, warning, defaulted };
}

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
      'ADR-LORE-017: slices that take a `project` param (git_project slug) — the set is read ' +
      'from the backend registry, not hard-coded here — fall back to the session\'s ' +
      'LORE_ACTIVE_PROJECT default when you omit it; passing one that differs from that default ' +
      'is allowed but the response carries a `_warning` field so the mismatch is never silent. ' +
      'If the registry cannot be reached, NO default is applied and the response says so — ' +
      'an unscoped answer must not look like a scoped one. ' +
      'SE-01: every slice accepts params limit (1..1000), offset (>=0) and fields (comma list of columns to keep) — ' +
      'e.g. {"limit":"1","fields":"release_id,is_current"} reads just the newest release instead of every description_md; ' +
      'a paged/projected answer carries _page ' +
      '{limit, offset, total, has_more}, so a page never looks like the full list.',
    {
      slice: z.string().describe('slice id from list_slices, e.g. "sprints"'),
      params: z
        .record(z.string(), z.string())
        .optional()
        .describe('slice parameters as string key/values, e.g. {"id":"ADR-FE-001"}'),
    },
    async ({ slice, params }) => {
      try {
        const { effectiveParams, warning } = await withProjectDefault(slice, params);
        const { rows, meta, page } = await loreSliceWithMeta(
          slice, Object.keys(effectiveParams).length ? effectiveParams : undefined);
        // Усечённая выдача обязана выглядеть усечённой: голый массив читался
        // как полный список, даже когда бэкенд прямо сказал «обрезал».
        if (!warning && !meta && !page) return json(rows);
        return json({
          rows,
          ...(page ? { _page: page } : {}),
          ...(meta ? { _truncated: meta.truncated, _limit: meta.limit, _hint: meta.hint } : {}),
          ...(warning ? { _warning: warning } : {}),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  // S6-08: агент выполняет блок lore-query из текста записи так же, как его
  // увидит пользователь, и узнаёт, полный ли ответ. Обёртка над /lore/slice —
  // своего эндпоинта нет: скоуп, усечение и страница уже приходят оттуда.
  server.tool(
    'run_block',
    'Execute a lore-query block (the source as it sits in a record\'s Markdown, SPEC-LORE-UXR-EMBED-BLOCKS) and return ' +
      'its rows WITH completeness metadata. READ status FIRST: "ok" | "error" — an error has NO rows (it is not an empty ' +
      'result) and carries error {stage: parse|execute, code, message}. Executable subset (the block language itself is an ' +
      'open question of the spec): `<slice> | where field = value [and field = value] | limit N | offset N | fields a,b | chart …` ' +
      '— where-pairs become slice params (see list_slices), chart is view-only (warning). group by, in (…), or/</>, and ' +
      '`question: N` (a saved Völva question) are refused explicitly rather than run distorted. $vars (e.g. $this.project) ' +
      'come from `vars`; an unset one is an error, never an empty param. meta: returned, total (null = unknown because the ' +
      'backend truncated), truncated, has_more, complete, limit/offset, scope {narrowed, project, project_source ' +
      '(block|session_default), backend_scope, scope_projects, outside_scope}, warnings[].',
    {
      block: z.string().describe('lore-query block: fenced ```lore-query … ``` or just its body, e.g. "sprints | where status = active | limit 20"'),
      vars: z
        .record(z.string(), z.string())
        .optional()
        .describe('values for $variables in the block, e.g. {"this.project":"NooriUta/UnlimitedLORE"}'),
    },
    async ({ block, vars }) => {
      const parsed = parseLoreQueryBlock(block, vars ?? {});
      if (!parsed.ok) {
        return { ...json({ status: 'error', error: { stage: 'parse', code: parsed.code, message: parsed.message } }), isError: true };
      }
      const blockProject = parsed.params.project ?? null;
      try {
        const { effectiveParams, warning, defaulted } = await withProjectDefault(parsed.slice, parsed.params);
        const { rows, meta, page, extra } = await loreSliceWithMeta(
          parsed.slice, Object.keys(effectiveParams).length ? effectiveParams : undefined);
        const warnings = [...parsed.warnings, ...(warning ? [warning] : [])];
        return json({
          status: 'ok',
          block: { slice: parsed.slice, params: effectiveParams },
          rows,
          meta: completeness(rows, meta, page, extra, {
            param: effectiveParams.project ?? null,
            source: defaulted ? 'session_default' : blockProject !== null ? 'block' : null,
          }, warnings),
        });
      } catch (e) {
        return {
          ...json({
            status: 'error',
            block: { slice: parsed.slice, params: parsed.params },
            error: { stage: 'execute', code: 'EXECUTE_FAILED', message: (e as Error).message ?? String(e) },
          }),
          isError: true,
        };
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
      'READ outcome FIRST: found | empty | partial_failure | failed — hits:[] with outcome=failed means the search did NOT run (see warnings), not that nothing exists. ' +
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

  // MT-TASK-SHAPE: форма и объём задач — статистика и вход для BI (Völva).
  server.tool(
    'task_shape',
    'Task shape & volume statistics (SPRINT_LORE_MEASURE_TRUTH/MT-TASK-SHAPE). Per task: project, status, type, ' +
      'effort_days, complexity class S/M/L/XL derived from factors (layers touched, prod data, hypothesis, owner ' +
      'decision, touch points), skeleton signals (steps, why, verify, test) and recommendation codes ' +
      '(epic|merge|stale_partial|steps|verify|test|probe|estimate). Fact for calibration: cycle_days created→done; ' +
      'created_done=true marks tasks logged already done (excluded from cycle medians). summary is per project plus "*". ' +
      'Note text is never returned. Use rows:false for the summary only — rows for all projects are large.',
    {
      project: z.string().optional().describe('git-project slug filter, e.g. "NooriUta/UnlimitedLORE"; omit = all projects'),
      rows: z.boolean().optional().describe('include per-task rows (default true)'),
    },
    async ({ project, rows }) => {
      try {
        const params: Record<string, string> = {};
        if (project) params.project = project;
        if (rows !== undefined) params.rows = String(rows);
        return json(await loreGet('/lore/task-shape', params));
      } catch (e) {
        return err(e);
      }
    },
  );

}
