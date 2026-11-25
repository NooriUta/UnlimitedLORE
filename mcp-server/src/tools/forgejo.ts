import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { lorePost, loreGet, loreEnvelope } from '../backend.js';

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${(e as Error).message ?? String(e)}` }],
  isError: true,
});

/**
 * Условная регистрация (ADR-LORE-024, FJ-04): forgejo_* инструменты появляются
 * ТОЛЬКО когда окружение MCP-сервера заявляет, что Forgejo-мост существует —
 * LORE_FORGEJO=true|1 или любой FORGEJO_*-env. У заказчика без self-hosted
 * Forgejo инструментов просто нет — LLM не видит их и не пытается звать
 * (лучше, чем 4 вечных 503). Сам токен живёт ТОЛЬКО в backend'е
 * (SecretProvider, FORGEJO_API_TOKEN) — MCP его не видит и не передаёт.
 */
export function forgejoConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LORE_FORGEJO === 'true' || env.LORE_FORGEJO === '1') return true;
  if (env.LORE_FORGEJO === 'false' || env.LORE_FORGEJO === '0') return false;
  return Object.keys(env).some((k) => k.startsWith('FORGEJO_') && (env[k] ?? '') !== '');
}

type Envelope = {
  v?: number; kind?: string; outcome?: string; data?: unknown;
  meta?: { has_more?: boolean; cursor?: string | null; truncated?: { kept?: number; dropped?: number } | null };
  error?: { code?: string; status?: number; allowed?: unknown[]; hint?: string } | null;
};

/**
 * Строка-сводка конверта для читателя-агента (FJ-03): вид, исход, объём, has_more/cursor, срез; у отказа — код,
 * статус, допуски и подсказка. failed ≠ empty: отказ называется отказом, а не «ничего не нашлось».
 */
export function envelopeSummary(e: Envelope): string {
  const head = `${e.kind ?? 'forgejo:?'} · ${e.outcome ?? '?'}`;
  if (e.outcome === 'failed' && e.error) {
    const allowed = Array.isArray(e.error.allowed) && e.error.allowed.length ? ` · allowed: ${e.error.allowed.join(', ')}` : '';
    return `${head} · ${e.error.code ?? 'ERROR'} ${e.error.status ?? ''}${allowed}${e.error.hint ? ` · next: ${e.error.hint}` : ''}`;
  }
  const n = Array.isArray(e.data) ? ` · ${e.data.length} items` : '';
  const more = e.meta && 'has_more' in e.meta ? ` · has_more=${e.meta.has_more}${e.meta.cursor ? ` cursor=${e.meta.cursor}` : ''}` : '';
  const tr = e.meta?.truncated ? ` · TRUNCATED kept=${e.meta.truncated.kept} dropped=${e.meta.truncated.dropped}` : '';
  return head + n + more + tr;
}

export function registerForgejo(server: McpServer, env: NodeJS.ProcessEnv = process.env): void {
  if (!forgejoConfigured(env)) return;

  // SPRINT_FORGEJO_MINIAPP/FJ-03 (ADR-LORE-060 R3): весь операционный Forgejo (107+ маршрутов бывшего forgejo-mcp)
  // — одним инструментом; реестр, RBAC, валидация, SSRF и truncate — в бэкенде. Знание о маршрутах — forgejo_describe.
  server.tool(
    'forgejo',
    'Forgejo miniapp (ADR-LORE-060): call ANY operational Forgejo route of the registry (107+ — issues, PRs, files, ' +
      'branches, releases, CI runs, orgs…) through LORE: route = name (e.g. "list_issues"), args = its params. ' +
      'Unknown route names and params → see forgejo_describe first. Answer = envelope v=1 {kind, outcome ' +
      'found|empty|failed, data, meta{cursor, has_more, truncated}, error{code,status,allowed,hint}}: a refusal ' +
      '(UNKNOWN_KIND, FORBIDDEN_FOR_ROLE, APPROVAL_REQUIRED, BAD_PARAMS, UPSTREAM_4XX…) is data with a next step, not ' +
      'an empty list. Lists: limit ≤ 50 (default 20), page=1 is implied; continue with args.cursor = meta.cursor. ' +
      'Merge stays forgejo_pr_merge (CI gate). The server holds the token.',
    {
      route: z.string().min(1).max(64).describe('route name from the registry, e.g. "list_issues", "get_file_contents"'),
      args: z.record(z.string(), z.unknown()).optional().describe('route params as an object, e.g. {"owner":"AIDA","repo":"UnlimitedLORE","limit":20}'),
      truncate: z.boolean().optional()
        .describe('false = no 6k cut (only when the result goes to a file/pipe, never into the dialogue); default true'),
    },
    async ({ route, args, truncate }) => {
      try {
        const q = truncate === false ? '?truncate=false' : '';
        const e = (await loreEnvelope(`/lore/forgejo-app/${encodeURIComponent(route)}${q}`, args ?? {})) as Envelope;
        return {
          content: [
            { type: 'text' as const, text: envelopeSummary(e) },
            { type: 'text' as const, text: JSON.stringify(e, null, 2) },
          ],
        };
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'forgejo_describe',
    'Forgejo miniapp catalogue (ADR-LORE-060 R3): without arguments — groups and route names YOUR role may call ' +
      '(allowlist); group="read|issues-write|PR|file-write|actions-read|dispatch|notifications|admin|repo-destructive" ' +
      '— that group only; route="<name>" — the card: method, path, params (type, required, in), roles, risk, guards ' +
      'and the error catalogue with next steps. Read before the first forgejo call of a route.',
    {
      route: z.string().min(1).max(72).optional().describe('route name or kind, e.g. "list_issues" or "forgejo:list_issues"'),
      group: z.string().min(1).max(32).optional().describe('route group of the RBAC matrix'),
    },
    async ({ route, group }) => {
      try {
        const params: Record<string, string> = {};
        if (route) params.route = route;
        if (group) params.group = group;
        return json(await loreGet('/lore/forgejo-app/describe', params));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'forgejo_pr_new',
    'Open a PR on the primary Forgejo host of a registered KnowGitProject. Graph-context path ' +
      '(ADR-LORE-024 §9): pass release_id to use the KnowRelease description_md as the PR body. ' +
      'The server holds the token; nothing secret passes through this tool. Target base defaults ' +
      'to "develop" (the project workflow: feature branch → PR → green CI → develop).',
    {
      git_project: z.string().describe('KnowGitProject slug, e.g. "NooriUta/UnlimitedLORE"'),
      head: z.string().describe('source branch, e.g. "feature/forgejo-bridge-v1052"'),
      base: z.string().optional().describe('target branch (default "develop")'),
      title: z.string().optional().describe('PR title (default: "release <release_id>" or head)'),
      release_id: z.string().optional()
        .describe('KnowRelease id (e.g. "v1.0.52") — its description_md becomes the PR body'),
      body_md: z.string().optional().describe('explicit PR body (overrides release description)'),
    },
    async (a) => {
      try { return json(await lorePost('/lore/forgejo/pr', a)); } catch (e) { return err(e); }
    },
  );

  server.tool(
    'forgejo_pr_status',
    'PR + CI gate status for a merge decision (ADR-LORE-024 §10). Returns status strictly from ' +
      '{NO_RUN, PENDING, GREEN, RED, UNKNOWN, STALLED} plus per-check states and merge_allowed. ' +
      'UNKNOWN/STALLED → diagnose via forgejo-mcp (§9), do not retry merge in a loop.',
    {
      git_project: z.string().describe('KnowGitProject slug'),
      number: z.number().int().describe('PR number'),
    },
    async ({ git_project, number }) => {
      try {
        return json(await loreGet(`/lore/forgejo/pr/${number}?git_project=${encodeURIComponent(git_project)}`));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'forgejo_pr_merge',
    'Merge a PR ONLY when the CI gate is GREEN (ADR-LORE-024 §10: every required check passing). ' +
      'Any other status → 409 with the actual gate state — fix CI or diagnose, never bypass. ' +
      'On success auto-links the graph (FJ-05): KnowPR + SHIPPED_IN to the release ' +
      '(release_id or the project\'s is_current), and sprint→release when sprint_id is given. ' +
      'linked:false in the answer means the release vertex was missing — run release_new + ' +
      'release_link yourself, the merge itself has already happened. ' +
      'MD-05: the merge also records the PR (title, url, merged_at, state → pr_recorded/pr_fields) and links ' +
      'CLOSED_BY task→PR for every SPRINT/CODE in the PR title (tasks_linked); codes with no such task come ' +
      'back in unmatched. Promotion PRs (base preprod/main) are not linked to tasks.',
    {
      git_project: z.string().describe('KnowGitProject slug'),
      number: z.number().int().describe('PR number'),
      release_id: z.string().optional()
        .describe('release to link the PR into (default: the project\'s is_current release)'),
      sprint_id: z.string().optional()
        .describe('sprint to link into the same release (IMPLEMENTED_IN_RELEASE edge)'),
    },
    async ({ git_project, number, release_id, sprint_id }) => {
      try {
        return json(await lorePost(`/lore/forgejo/pr/${number}/merge`, { git_project, release_id, sprint_id }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'forgejo_ci_status',
    'CI gate status (§10 vocabulary) for an arbitrary ref/branch — check your branch is GREEN ' +
      'before opening a PR. For run logs and re-runs use forgejo-mcp (§9), not this tool.',
    {
      git_project: z.string().describe('KnowGitProject slug'),
      ref: z.string().describe('branch name or commit sha'),
    },
    async ({ git_project, ref }) => {
      try {
        return json(await loreGet(
          `/lore/forgejo/ci?git_project=${encodeURIComponent(git_project)}&ref=${encodeURIComponent(ref)}`));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'forgejo_branch_protection',
    'READ branch protection of the project\'s primary Forgejo repo (ADR-LORE-024 решение 136: ' +
      'the bridge never writes protection — changing it is a human-only operation). Omit branch ' +
      'to list all protections.',
    {
      git_project: z.string().describe('KnowGitProject slug'),
      branch: z.string().optional().describe('branch name; omit for the full list'),
    },
    async ({ git_project, branch }) => {
      try {
        const q = branch ? `&branch=${encodeURIComponent(branch)}` : '';
        return json(await loreGet(`/lore/forgejo/branch-protection?git_project=${encodeURIComponent(git_project)}${q}`));
      } catch (e) { return err(e); }
    },
  );
}
