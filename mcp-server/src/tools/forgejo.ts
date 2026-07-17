import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { lorePost, loreGet } from '../backend.js';

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

export function registerForgejo(server: McpServer, env: NodeJS.ProcessEnv = process.env): void {
  if (!forgejoConfigured(env)) return;

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
      'release_link yourself, the merge itself has already happened.',
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
