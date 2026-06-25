import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { lorePost } from '../backend.js';

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${(e as Error).message ?? String(e)}` }],
  isError: true,
});

export function registerLoreWrite(server: McpServer): void {
  // SCD2 status transition (closes the open history row, opens a new one, edges,
  // denormalizes status onto the vertex). Writes to the shared system_aida_lore.
  server.tool(
    'lore_set_status',
    'Set the status of a LORE entity (SCD2 transition). Mutates the shared ' +
      'system_aida_lore — use deliberately. Returns the new revision.',
    {
      entity_type: z.enum(['plan_item', 'sprint', 'task', 'checkpoint']),
      id: z.string().describe('entity id (e.g. sprint_id, task_uid, item_id, checkpoint_id)'),
      status: z.enum(['todo', 'active', 'partial', 'done', 'blocked', 'high', 'cancelled']),
    },
    async ({ entity_type, id, status }) => {
      try {
        return json(await lorePost('/lore/status', { entity_type, id, status }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'lore_create_task',
    'Create a new task under a sprint (appends with the next order_index, opens an ' +
      'initial PLANNED history state). Mutates the shared system_aida_lore.',
    {
      sprint_id: z.string(),
      task_id: z.string().describe('short task id, unique within the sprint'),
      title: z.string(),
      note_md: z.string().optional().describe('optional Markdown note'),
    },
    async ({ sprint_id, task_id, title, note_md }) => {
      try {
        return json(await lorePost('/lore/task', { sprint_id, task_id, title, note_md: note_md ?? null }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'lore_register_sprint',
    'Register a real sprint for a standalone plan-item placeholder: create a ' +
      'KnowSprint, seed its initial status, and link the plan-item via REPRESENTS ' +
      '(the bar flips from placeholder to sprint). Idempotent — a plan-item that ' +
      'already represents a sprint is returned unchanged. Mutates system_aida_lore.',
    {
      item_id: z.string().describe('plan-item id (from plan_items) to back with a sprint'),
      sprint_id: z.string().optional().describe('explicit sprint id; default SPRINT_<ITEM_ID>'),
      name: z.string().optional().describe('sprint name; default the plan-item label'),
      status: z
        .enum(['todo', 'active', 'partial', 'done', 'blocked', 'high', 'cancelled'])
        .optional()
        .describe('initial status, default "active"'),
    },
    async ({ item_id, sprint_id, name, status }) => {
      try {
        return json(await lorePost('/lore/sprint', {
          item_id, sprint_id: sprint_id ?? null, name: name ?? null, status: status ?? 'active',
        }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'lore_update_sprint',
    'Update metadata fields on a KnowSprint vertex (partial update — only supplied fields written). ' +
      'Covers name, outcome_md, priority, plan_id, effort_days. ' +
      'Does NOT change status — use lore_set_status for that.',
    {
      sprint_id:   z.string().describe('e.g. "SPRINT_HOUND_ROWSET_V2"'),
      name:        z.string().optional(),
      outcome_md:  z.string().optional().describe('sprint outcome / retrospective in Markdown'),
      priority:    z.string().optional().describe('e.g. "high", "critical"'),
      plan_id:     z.string().optional(),
      effort_days: z.number().int().optional().describe('actual effort in person-days'),
    },
    async ({ sprint_id, name, outcome_md, priority, plan_id, effort_days }) => {
      try {
        return json(await lorePost('/lore/sprint/update', {
          sprint_id,
          name: name ?? null, outcome_md: outcome_md ?? null,
          priority: priority ?? null, plan_id: plan_id ?? null,
          effort_days: effort_days ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_batch_set_status',
    'Set the same status on multiple LORE entities in one call. ' +
      'Each item goes through the full SCD2 transition (closes old hist row, opens new one). ' +
      'Errors are collected per-item without aborting the rest. ' +
      'Returns {ok, updated, errors[]}.',
    {
      entity_type: z.enum(['plan_item', 'sprint', 'task', 'checkpoint']),
      ids:         z.array(z.string()).describe('list of entity ids'),
      status:      z.enum(['todo', 'active', 'partial', 'done', 'blocked', 'high', 'cancelled']),
    },
    async ({ entity_type, ids, status }) => {
      try {
        return json(await lorePost('/lore/status/batch', { entity_type, ids, status }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_adr',
    'Create or update a KnowADR (Architecture Decision Record). Idempotent — upserts by adr_id. ' +
      'Default status is PROPOSED. Supports context_md / decision_md / consequences_md sections.',
    {
      adr_id:           z.string().describe('e.g. "ADR-HND-022"'),
      name:             z.string().describe('short title'),
      status:           z.enum(['PROPOSED', 'ACCEPTED', 'DEPRECATED', 'SUPERSEDED']).optional(),
      date_created:     z.string().optional().describe('YYYY-MM-DD, defaults to today'),
      component_id:     z.string().optional().describe('e.g. "HND" for Hound'),
      context_md:       z.string().optional(),
      decision_md:      z.string().optional(),
      consequences_md:  z.string().optional(),
    },
    async ({ adr_id, name, status, date_created, component_id, context_md, decision_md, consequences_md }) => {
      try {
        return json(await lorePost('/lore/adr', {
          adr_id, name,
          status: status ?? null, date_created: date_created ?? null,
          component_id: component_id ?? null, context_md: context_md ?? null,
          decision_md: decision_md ?? null, consequences_md: consequences_md ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_decision',
    'Create or update a KnowDecision (logged decision/verdict). Idempotent — upserts by decision_id. ' +
      'Use for recording key decisions made during a sprint or design session.',
    {
      decision_id:  z.string().describe('unique id, e.g. "D-2026-047"'),
      title:        z.string(),
      body_md:      z.string().optional().describe('full decision text in Markdown'),
      date_created: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
      refs_raw:     z.string().optional().describe('free-text references, e.g. "#420, ADR-HND-021"'),
    },
    async ({ decision_id, title, body_md, date_created, refs_raw }) => {
      try {
        return json(await lorePost('/lore/decision', {
          decision_id, title,
          body_md: body_md ?? null, date_created: date_created ?? null,
          refs_raw: refs_raw ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_update_sprint_refs',
    'Append PR numbers to a sprint\'s pr_refs field (stored on the open KnowSprintHist row ' +
      'as a markdown link string). Skips PRs already present. ' +
      'Returns the updated pr_refs string and count of newly added links.',
    {
      sprint_id:  z.string().describe('e.g. "SPRINT_HOUND_ROWSET_V2"'),
      pr_numbers: z.array(z.number().int()).describe('PR numbers to append, e.g. [420, 421]'),
      repo_url:   z.string().optional()
        .describe('base URL for PR links (default: https://github.com/NooriUta/AIDA/pull)'),
    },
    async ({ sprint_id, pr_numbers, repo_url }) => {
      try {
        return json(await lorePost('/lore/sprint/refs', {
          sprint_id, pr_numbers, repo_url: repo_url ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  // ── Release management ──────────────────────────────────────────────────

  server.tool(
    'lore_create_release',
    'Create a new KnowRelease vertex in system_aida_lore. ' +
      'If is_current=true, the previous current release is automatically cleared. ' +
      'Returns the created release_id and timestamp.',
    {
      release_id:     z.string().describe('release id, e.g. "v1.6.12"'),
      release_date:   z.string().optional().describe('YYYY-MM-DD'),
      git_tag:        z.string().optional(),
      type:           z.enum(['patch', 'minor', 'major']).optional(),
      description_md: z.string().optional().describe('changelog / release notes in Markdown'),
      is_current:     z.boolean().optional().default(false).describe('mark as current prod release'),
      week:           z.number().int().optional().describe('plan week number (relative to W0)'),
    },
    async ({ release_id, release_date, git_tag, type, description_md, is_current, week }) => {
      try {
        return json(await lorePost('/lore/release', {
          release_id, release_date: release_date ?? null,
          git_tag: git_tag ?? null, type: type ?? null,
          description_md: description_md ?? null,
          is_current: is_current ?? false, week: week ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_update_release',
    'Update fields on an existing KnowRelease (partial update — only supplied fields are written). ' +
      'If is_current=true, clears the previous current release first. ' +
      'Useful for adding description_md / git_tag after the release is live.',
    {
      release_id:     z.string().describe('existing release id, e.g. "v1.6.11"'),
      git_tag:        z.string().optional(),
      release_date:   z.string().optional().describe('YYYY-MM-DD'),
      description_md: z.string().optional().describe('changelog in Markdown'),
      is_current:     z.boolean().optional().describe('promote to current prod release'),
    },
    async ({ release_id, git_tag, release_date, description_md, is_current }) => {
      try {
        return json(await lorePost('/lore/release/update', {
          release_id,
          git_tag: git_tag ?? null,
          release_date: release_date ?? null,
          description_md: description_md ?? null,
          is_current: is_current ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_link_release_pr',
    'Link sprints and/or PRs to a KnowRelease. ' +
      'For each sprint_id creates an IMPLEMENTED_IN_RELEASE edge (KnowSprint → KnowRelease). ' +
      'For each pr_number upserts a KnowPR vertex and creates a SHIPPED_IN edge (KnowPR → KnowRelease). ' +
      'Returns counts of linked sprints and PRs.',
    {
      release_id:  z.string().describe('target release, e.g. "v1.6.11"'),
      sprint_ids:  z.array(z.string()).optional().describe('e.g. ["SPRINT_HOUND_ROWSET_V2"]'),
      pr_numbers:  z.array(z.number().int()).optional().describe('e.g. [401, 402]'),
    },
    async ({ release_id, sprint_ids, pr_numbers }) => {
      try {
        return json(await lorePost('/lore/release/link', {
          release_id,
          sprint_ids: sprint_ids ?? [],
          pr_numbers: pr_numbers ?? [],
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_edit_task',
    'Edit one task OR a batch of tasks (title + note_md). Updates the vertex and its ' +
      'open history row. Mutates the shared system_aida_lore.\n\n' +
      'Single: pass task_uid + title (+ optional note_md).\n' +
      'Batch:  pass tasks=[{task_uid, title, note_md?}, ...] — all processed in one call, ' +
      'errors collected per-item without aborting the rest.',
    {
      task_uid: z.string().optional().describe('single-mode: full task uid, e.g. "SPRINT_X/SH-1"'),
      title:    z.string().optional().describe('single-mode: new title'),
      note_md:  z.string().optional().describe('single-mode: Markdown note (replaces existing)'),
      tasks: z.array(z.object({
        task_uid: z.string(),
        title:    z.string(),
        note_md:  z.string().optional(),
      })).optional().describe('batch-mode: array of {task_uid, title, note_md?}'),
    },
    async ({ task_uid, title, note_md, tasks }) => {
      try {
        if (tasks && tasks.length > 0) {
          return json(await lorePost('/lore/task/edit/batch',
            tasks.map(t => ({ task_uid: t.task_uid, title: t.title, note_md: t.note_md ?? null }))));
        }
        if (!task_uid || !title) return err(new Error('provide either tasks[] (batch) or task_uid+title (single)'));
        return json(await lorePost('/lore/task/edit', { task_uid, title, note_md: note_md ?? null }));
      } catch (e) { return err(e); }
    },
  );
}
