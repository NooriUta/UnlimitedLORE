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
      '{limit, offset, total, has_more}, so a page never looks like the full list. ' +
      'MT-MCP-CHANGED-RANGE: every slice whose rows carry changed_at also accepts changed_from / changed_to ' +
      '(ISO date YYYY-MM-DD or date-time, both bounds inclusive, UTC; a date as changed_to means the whole day) ' +
      'and sort=changed_at:desc|asc — e.g. slice "closed_tasks" with {"changed_from":"2026-11-11","sort":"changed_at:desc"} = closed today. ' +
      'Filter and sort run before limit/offset; _page.total counts the filtered rows and echoes changed_from/changed_to/sort. ' +
      'A slice without changed_at answers 400 BAD_PARAMS instead of ignoring the range.',
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

  // MT-MCP-CHANGED-RANGE (остаток, v1.17.14): «что изменилось с … по …» по многим типам одним
  // вызовом. Тонкая обёртка над GET /lore/changed: параметры уходят как есть, проект НЕ
  // подставляется из LORE_ACTIVE_PROJECT (у вех проектной оси нет — неявный фильтр выбил бы тип
  // в errors[] в каждом вызове); ответ — целиком, вместе с errors[]/complete.
  server.tool(
    'changed',
    'What changed in a period, across many object types in ONE call (GET /lore/changed, MT-MCP-CHANGED-RANGE). ' +
      'READ complete FIRST: complete:false means some types were NOT read (see errors[] {type, stage: list|history|project, reason}) — ' +
      'then an empty or short answer is NOT proof that nothing changed; nothing_changed:true is set only for a complete answer with 0 rows. ' +
      'Rows (newest first): type, ref_id, title, status_was → status_now (status_was = the SCD2 version open just before `from`; ' +
      'null with created_in_period:true when the record appeared inside the period), status_changed, status_category, ' +
      'changed_at (ISO UTC), changed_by/changed_by_kind (author of the last version inside the period; null for in-place edits ' +
      'that open no version), history: versions|none|unavailable|not_tracked, projects. page {limit, offset, total, has_more}. ' +
      'from/to: ISO date YYYY-MM-DD or date-time, both bounds inclusive, UTC; a date as `to` means the whole day; at least one is required. ' +
      'types: CSV of task, adr, decision, spec, question, release, sprint, milestone, component, feature (default: all). ' +
      'status_category: open | closed | a category (not_started, in_progress, in_force, finished, withdrawn, unknown). ' +
      'Examples: tasks closed today → {types:"task", from:"2026-11-11", status_category:"closed"}; ' +
      'everything changed 10–11 Nov → {from:"2026-11-10", to:"2026-11-11"}. ' +
      'project is NOT defaulted from LORE_ACTIVE_PROJECT; a type without a project axis (milestone) goes to errors[] when project is given. ' +
      'The caller\'s project scope applies as in every slice.',
    {
      from: z.string().optional().describe('period start, inclusive: YYYY-MM-DD (00:00 UTC) or date-time'),
      to: z.string().optional().describe('period end, inclusive: YYYY-MM-DD (whole day, UTC) or date-time'),
      types: z.string().optional().describe('CSV, e.g. "task,adr,decision"; default all ten types'),
      project: z.string().optional().describe('git_project slug, e.g. "NooriUta/UnlimitedLORE" — explicit only'),
      status_category: z.string().optional().describe('open | closed | not_started | in_progress | in_force | finished | withdrawn | unknown'),
      actor: z.string().optional().describe('author of the last version in the period (changed_by), case-insensitive'),
      limit: z.number().int().min(1).max(1000).optional().describe('page size (default 200)'),
      offset: z.number().int().min(0).optional(),
    },
    async ({ from, to, types, project, status_category, actor, limit, offset }) => {
      try {
        const params: Record<string, string> = {};
        if (from !== undefined) params.from = from;
        if (to !== undefined) params.to = to;
        if (types !== undefined) params.types = types;
        if (project !== undefined) params.project = project;
        if (status_category !== undefined) params.status_category = status_category;
        if (actor !== undefined) params.actor = actor;
        if (limit !== undefined) params.limit = String(limit);
        if (offset !== undefined) params.offset = String(offset);
        return json(await loreGet('/lore/changed', params));
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

  // SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04 (11.11.2026): граф одним запросом — тот же GET /lore/graph,
  // что у GraphExplorer. Тонкая обёртка: параметры как есть, проект из LORE_ACTIVE_PROJECT
  // не подставляется (скоуп вызывающего режет сервер), ответ — целиком вместе с meta.
  server.tool(
    'graph',
    'LORE graph in ONE call (GET /lore/graph, SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04): nodes[{id,type,title,status,status_category,depth}] + ' +
      'edges[{from,rel,to,kind?}] + meta. TWO MODES, exactly one: (1) neighborhood of a record — type + id, depth 1..4 ' +
      '(BFS both directions; depth 4 is wide — narrow it with rels), (2) slice — scope=all|project:<slug>|component:<id> ' +
      '(the records plus ONE ring of neighbours). rels = CSV of edge types (e.g. "DEPENDS_ON,JUSTIFIED_BY"): the walk goes ONLY ' +
      'through those edges at every step, a path never passes through an edge of another type. types = CSV of node types (task, adr, ' +
      'decision, spec, sprint, …) — other types are neither returned nor walked through. structural=true adds the structural layer ' +
      '(PART_OF, BELONGS_TO_PROJECT, … marked kind:"structural"; off by default). limit caps nodes (neighborhood default 500, slice 10000, ' +
      'max 20000). READ meta FIRST: complete:false / truncated:true + capped_at:N mean the graph is NOT the whole neighborhood; ' +
      'dangling[{id,rel,dir,reason: missing|hidden_by_scope,count}] names cut ends; hidden_by_scope counts nodes outside the caller\'s ' +
      'projects; frontier_edges:"not_read" — edges between two last-level nodes are not read. meta.rels_available[{rel,count}] lists ' +
      'edge types of the neighborhood at the requested depth WITHOUT the rels filter (count desc, then rel) — use it to pick rels; ' +
      'meta.by_depth {"1":n,"2":n,…} counts nodes per level (root excluded, an empty level is 0).',
    {
      type: z.string().optional().describe('neighborhood: record type, e.g. "adr", "task", "sprint", "spec", "decision"'),
      id: z.string().optional().describe('neighborhood: business key, e.g. "ADR-LORE-038" or "SPRINT_X/CO-11" for a task'),
      depth: z.number().int().min(1).max(4).optional().describe('neighborhood: rings to walk, 1..4 (default 1)'),
      scope: z.string().optional().describe('slice instead of a neighborhood: all | project:<slug> | component:<id>'),
      rels: z.string().optional().describe('CSV of edge types to walk ONLY, e.g. "DEPENDS_ON"; see meta.rels_available'),
      types: z.string().optional().describe('CSV of node types to keep, e.g. "adr,decision"'),
      structural: z.boolean().optional().describe('include structural edges (PART_OF, BELONGS_TO_PROJECT, …); default false'),
      limit: z.number().int().min(1).max(20000).optional().describe('node cap; neighborhood default 500, slice 10000'),
    },
    async ({ type, id, depth, scope, rels, types, structural, limit }) => {
      try {
        const params: Record<string, string> = {};
        if (type !== undefined) params.type = type;
        if (id !== undefined) params.id = id;
        if (depth !== undefined) params.depth = String(depth);
        if (scope !== undefined) params.scope = scope;
        if (rels !== undefined) params.rels = rels;
        if (types !== undefined) params.types = types;
        if (structural !== undefined) params.structural = String(structural);
        if (limit !== undefined) params.limit = String(limit);
        return json(await loreGet('/lore/graph', params));
      } catch (e) {
        return err(e);
      }
    },
  );

}
