import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLoreRead } from './loreRead.js';
import { registerLoreWrite } from './loreWrite.js';

// Regression guard for ADR-LORE-014 §2 (T02): every tool renamed lore_* -> <category>_<verb>,
// ~22 lore_link_*/lore_unlink_* collapsed into 8 <category>_link(rel, ...) tools. A stray
// `lore_*` name creeping back in (partial revert, bad merge, copy-pasted old snippet) would
// silently break every caller relying on the new names — this catches it at test time instead
// of live, by recording every server.tool(name, ...) call against a fake McpServer double.
function fakeServer() {
  const names: string[] = [];
  const server = {
    tool: (...args: unknown[]) => { names.push(args[0] as string); },
  } as unknown as McpServer;
  return { server, names };
}

describe('registerLoreRead', () => {
  it('registers exactly the two Meta read tools under their new names', () => {
    const { server, names } = fakeServer();
    registerLoreRead(server);
    expect(names).toEqual(['list_slices', 'query_slice']);
  });
});

describe('registerLoreWrite', () => {
  it('registers no lore_*-prefixed tool name (T02 rename is complete)', () => {
    const { server, names } = fakeServer();
    registerLoreWrite(server);
    const stragglers = names.filter(n => n.startsWith('lore_'));
    expect(stragglers).toEqual([]);
  });

  it('registers the expected total tool count (60 — 58 in loreWrite + 2 in loreRead)', () => {
    const { server, names } = fakeServer();
    registerLoreWrite(server);
    expect(names).toHaveLength(58);
  });

  it('registers every name exactly once (no accidental duplicate registration)', () => {
    const { server, names } = fakeServer();
    registerLoreWrite(server);
    expect(new Set(names).size).toBe(names.length);
  });

  it('registers the simple renames from MIGRATION.md', () => {
    const { server, names } = fakeServer();
    registerLoreWrite(server);
    for (const expected of [
      'status_set', 'status_set_batch', 'task_new', 'task_mv', 'sprint_new',
      'sprint_phase_new', 'adr_new', 'adr_set', 'adr_rename', 'adr_del',
      'decision_new', 'release_new', 'release_set', 'spec_new', 'spec_set', 'spec_del',
      'tech_set', 'qg_new', 'qg_job_new', 'qg_run_log', 'rec_new', 'rec_promote',
      'runbook_new', 'doc_new', 'doc_del', 'component_new', 'component_set',
      'dict_set', 'metric_log', 'metric_get', 'insight_new',
      'bragi_rubric_set', 'bragi_channel_set', 'bragi_pub_new', 'bragi_variant_new',
      'bragi_keyword_set', 'bragi_search', 'bragi_page_set', 'bragi_campaign_new',
      'bragi_integration_new', 'bragi_sync',
    ]) {
      expect(names, `missing renamed tool: ${expected}`).toContain(expected);
    }
  });

  it('registers the 8 rel-based link-collapse tools + release_unlink (kept separate)', () => {
    const { server, names } = fakeServer();
    registerLoreWrite(server);
    for (const expected of [
      'adr_link', 'sprint_link', 'task_link', 'doc_link',
      'release_link', 'release_unlink', 'bragi_link', 'runbook_link', 'insight_link',
    ]) {
      expect(names, `missing link tool: ${expected}`).toContain(expected);
    }
  });

  it('registers the ADR-text-gap renames (bragi_asset_*, release_mv)', () => {
    const { server, names } = fakeServer();
    registerLoreWrite(server);
    expect(names).toContain('bragi_asset_up');
    expect(names).toContain('bragi_asset_attach');
    expect(names).toContain('release_mv');
  });

  it('registers project_new (T15 — first write path for KnowGitProject)', () => {
    const { server, names } = fakeServer();
    registerLoreWrite(server);
    expect(names).toContain('project_new');
  });

  it('does not register sprint_set as two separate tools (merged from lore_update_sprint + lore_update_sprint_refs)', () => {
    const { server, names } = fakeServer();
    registerLoreWrite(server);
    expect(names.filter(n => n === 'sprint_set')).toHaveLength(1);
    expect(names).not.toContain('lore_update_sprint');
    expect(names).not.toContain('lore_update_sprint_refs');
  });
});
