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

// Full set of statuses accepted by the backend (mirrors AidaLoreResource.VALID_STATUSES).
// Keep in sync with: Set.of("todo","active","partial","done","blocked","high","cancelled",
//                           "planned","backlog","design","ready_for_deploy")
const LORE_STATUS = z.enum([
  'todo', 'planned', 'active', 'partial', 'done',
  'blocked', 'high', 'cancelled', 'backlog', 'design', 'ready_for_deploy',
]);

export function registerLoreWrite(server: McpServer): void {
  // SCD2 status transition (closes the open history row, opens a new one, edges,
  // denormalizes status onto the vertex). Writes to the shared system_aida_lore.
  server.tool(
    'lore_set_status',
    'Set the status of a LORE entity (SCD2 transition). Mutates the shared ' +
      'system_aida_lore — use deliberately. Returns the new revision.',
    {
      entity_type: z.enum(['plan_item', 'sprint', 'task', 'checkpoint', 'phase']),
      id: z.string().describe('entity id (e.g. sprint_id, task_uid, item_id, phase_uid "SPRINT_X/PHASE_A")'),
      status: LORE_STATUS,
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
      'initial PLANNED history state). Optionally attaches the task to a sprint phase ' +
      '(IN_PHASE edge — the tasks_of_phase slice reads it). Mutates the shared system_aida_lore.',
    {
      sprint_id: z.string(),
      task_id: z.string().describe('short task id, unique within the sprint'),
      title: z.string(),
      note_md: z.string().optional().describe('optional Markdown note'),
      phase_uid: z.string().optional()
        .describe('optional phase to attach to, e.g. "SPRINT_X/PHASE_A" (must belong to the same sprint; create via lore_create_phase first)'),
    },
    async ({ sprint_id, task_id, title, note_md, phase_uid }) => {
      try {
        return json(await lorePost('/lore/task', {
          sprint_id, task_id, title,
          note_md: note_md ?? null, phase_uid: phase_uid ?? null,
        }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'lore_create_phase',
    'Create a sprint phase (KnowPhase): PART_OF → sprint, initial PLANNED history state. ' +
      'phase_uid = "<sprint_id>/PHASE_<KEY>". Idempotent — an existing phase is returned ' +
      'unchanged (created=false). Attach tasks via lore_create_task(phase_uid) or ' +
      'lore_link_task_phase. Mutates the shared system_aida_lore.',
    {
      sprint_id: z.string().describe('e.g. "SPRINT_GEOID_STRUCTURAL_ID"'),
      phase_key: z.string().describe('short phase key, e.g. "A", "B", "1" → phase_uid "SPRINT_X/PHASE_A", display "Фаза A"'),
      name: z.string().optional().describe('optional human-readable phase name'),
      order_index: z.number().int().optional().describe('explicit position; default = max existing + 1'),
    },
    async ({ sprint_id, phase_key, name, order_index }) => {
      try {
        return json(await lorePost('/lore/phase', {
          sprint_id, phase_key,
          name: name ?? null, order_index: order_index ?? null,
        }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'lore_link_task_phase',
    'Link (or unlink) a task to a sprint phase via an IN_PHASE edge. Task and phase must ' +
      'belong to the same sprint. Idempotent on add. action="remove" detaches (omit ' +
      'phase_uid with remove to detach the task from ALL phases). Mutates system_aida_lore.',
    {
      task_uid: z.string().describe('full task uid, e.g. "SPRINT_X/B1"'),
      phase_uid: z.string().optional().describe('phase uid, e.g. "SPRINT_X/PHASE_B"; required for add'),
      action: z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ task_uid, phase_uid, action }) => {
      try {
        return json(await lorePost('/lore/task/phase', {
          task_uid, phase_uid: phase_uid ?? null, action: action ?? 'add',
        }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'lore_create_sprint',
    'Create a new KnowSprint vertex directly — no plan-item required. ' +
      'Idempotent (upsert by sprint_id). Seeds an initial HAS_STATE history row. ' +
      'Use lore_register_sprint instead when a plan-item placeholder already exists ' +
      '(it also wires the Gantt bar). Mutates system_aida_lore.',
    {
      sprint_id:  z.string().describe('unique sprint id, e.g. "SPRINT_SITE_EXTRACT"'),
      name:       z.string().describe('human-readable sprint name'),
      status:     LORE_STATUS.optional().default('todo'),
      item_id:    z.string().optional()
                   .describe('plan-item id for the Gantt bar; default = sprint_id with SPRINT_ stripped'),
      plan_id:    z.string().optional().describe('optional plan this sprint belongs to'),
      priority:   z.string().optional().describe('e.g. "high", "critical"'),
      outcome_md: z.string().optional().describe('sprint goal / outcome in Markdown'),
      context_md: z.string().optional().describe('background context for the sprint — WHY it exists, key decisions, related sprints, links to docs. Shown in sprint detail panel.'),
    },
    async ({ sprint_id, name, status, item_id, plan_id, priority, outcome_md, context_md }) => {
      try {
        return json(await lorePost('/lore/sprint/create', {
          sprint_id, name,
          status: status ?? 'todo',
          item_id: item_id ?? null,
          plan_id: plan_id ?? null,
          priority: priority ?? null,
          outcome_md: outcome_md ?? null,
          context_md: context_md ?? null,
        }));
      } catch (e) { return err(e); }
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
      'Covers name, outcome_md, context_md, priority, plan_id, effort_days. ' +
      'Does NOT change status — use lore_set_status for that. ' +
      'RULE: always fill context_md when you know WHY the sprint exists, key decisions, or related sprints.',
    {
      sprint_id:   z.string().describe('e.g. "SPRINT_HOUND_ROWSET_V2"'),
      name:        z.string().optional(),
      outcome_md:  z.string().optional().describe('sprint outcome / retrospective in Markdown'),
      context_md:  z.string().optional().describe('background context — WHY the sprint exists, key decisions, links to ADRs/docs, related sprints. Fill whenever you have this information.'),
      priority:    z.string().optional().describe('e.g. "high", "critical"'),
      plan_id:     z.string().optional(),
      effort_days: z.number().int().optional().describe('actual effort in person-days'),
    },
    async ({ sprint_id, name, outcome_md, context_md, priority, plan_id, effort_days }) => {
      try {
        return json(await lorePost('/lore/sprint/update', {
          sprint_id,
          name: name ?? null, outcome_md: outcome_md ?? null,
          context_md: context_md ?? null,
          priority: priority ?? null, plan_id: plan_id ?? null,
          effort_days: effort_days ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_link_sprint_project',
    'Link (or unlink) a KnowSprint to a KnowGitProject via BELONGS_TO_PROJECT edge. ' +
      'A sprint can belong to multiple projects (e.g. a cross-repo sprint). ' +
      'Idempotent on add. Use action="remove" to unlink. ' +
      'Known slugs: "NooriUta/AIDA", "NooriUta/seidr-site", "NooriUta/aida-documentation", "NooriUta/AIDA-TestPlayGround".',
    {
      sprint_id:   z.string().describe('e.g. "SPRINT_HOUND_ROWSET_V2"'),
      git_project: z.string().describe('project slug, e.g. "NooriUta/AIDA"'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ sprint_id, git_project, action }) => {
      try {
        return json(await lorePost('/lore/sprint/project', {
          sprint_id, git_project, action: action ?? 'add',
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_link_sprint_dep',
    'Link (or unlink) two KnowSprint vertices via a DEPENDS_ON edge (from_sprint depends on to_sprint). ' +
      'Idempotent on add. Cycle-guard on server rejects edges that would create a cycle. ' +
      'kind: hard (blocks deployment), soft (coordination), gate (go/no-go), informs (awareness). ' +
      'Use action="remove" to delete the dependency.',
    {
      from_sprint: z.string().describe('the sprint that depends on another, e.g. "SPRINT_FE_REDESIGN"'),
      to_sprint:   z.string().describe('the sprint being depended on, e.g. "SPRINT_INFRA_V3"'),
      kind:        z.enum(['hard', 'soft', 'gate', 'informs']).optional().default('soft'),
      reason:      z.string().optional().describe('brief reason for the dependency'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ from_sprint, to_sprint, kind, reason, action }) => {
      try {
        return json(await lorePost('/lore/sprint/dep', {
          from_sprint, to_sprint,
          kind: kind ?? 'soft',
          reason: reason ?? null,
          action: action ?? 'add',
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_link_sprint_component',
    'Link (or unlink) a KnowSprint to a LoreComponent via a BELONGS_TO edge. ' +
      'An explicit link OVERRIDES the fuzzy naming-convention match (sprint_id LIKE %component_key%) ' +
      'in the component_sprints slice and the sprint-detail module badges. ' +
      'Idempotent on add. Use action="remove" to unlink.',
    {
      sprint_id:    z.string().describe('the sprint, e.g. "SPRINT_LORE_WRITE_TOOLS"'),
      component_id: z.string().describe('the component, e.g. "OMILORE", "FORSETI", "FORSETI_MCP"'),
      action:       z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ sprint_id, component_id, action }) => {
      try {
        return json(await lorePost('/lore/sprint/component', {
          sprint_id, component_id, action: action ?? 'add',
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_link_task_component',
    'Tag (or untag) a KnowTask with a LoreComponent via a TAGGED_WITH edge. ' +
      'Many-to-many: a task can be linked to 0..N components. ' +
      'Idempotent on add. Use action="remove" to remove the tag.',
    {
      task_uid:     z.string().describe('the task uid, e.g. "SPRINT_LORE_WRITE_TOOLS/T01"'),
      component_id: z.string().describe('the component, e.g. "OMILORE", "FORSETI"'),
      action:       z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ task_uid, component_id, action }) => {
      try {
        return json(await lorePost('/lore/task/component', {
          task_uid, component_id, action: action ?? 'add',
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_update_plan_item',
    'Link (or unlink) a PlanItem to a KnowMilestone via a CONTRIBUTES_TO edge. ' +
      'Architecture: Milestone ← CONTRIBUTES_TO ← PlanItem → REPRESENTS → KnowSprint. ' +
      'This is the canonical way to assign a sprint to a milestone when the sprint has a plan-item. ' +
      'For sprints without a plan-item bridge use lore_link_sprint_milestone (TARGETS_MILESTONE direct edge). ' +
      'Use action="remove" to unlink (omit milestone_id to remove ALL milestone links from this item). ' +
      'Idempotent on add. Returns {ok, item_id, milestone_id, action}.',
    {
      item_id:      z.string().describe('plan-item id, e.g. "SPRINT_LORE_QG_INTEGRATION"'),
      milestone_id: z.string().optional().describe('milestone id to link; omit only when action="remove" to clear all'),
      action:       z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ item_id, milestone_id, action }) => {
      try {
        return json(await lorePost('/lore/plan-item/milestone', {
          item_id, milestone_id: milestone_id ?? null, action: action ?? 'add',
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_link_sprint_milestone',
    'Link (or unlink) a KnowSprint directly to a KnowMilestone via a TARGETS_MILESTONE edge. ' +
      'Use this for sprints that do NOT have a PlanItem bridge (most sprints). ' +
      'For sprints that DO have a PlanItem, prefer lore_update_plan_item (CONTRIBUTES_TO path). ' +
      'Idempotent on add. Use action="remove" to unlink. Returns {ok, sprint_id, milestone_id, action}.',
    {
      sprint_id:    z.string().describe('sprint id, e.g. "SPRINT_LORE_QG_INTEGRATION"'),
      milestone_id: z.string().describe('milestone id, e.g. "M3"'),
      action:       z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ sprint_id, milestone_id, action }) => {
      try {
        return json(await lorePost('/lore/milestone/sprint', {
          sprint_id, milestone_id, action: action ?? 'add',
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
      entity_type: z.enum(['plan_item', 'sprint', 'task', 'checkpoint', 'phase']),
      ids:         z.array(z.string()).describe('list of entity ids'),
      status:      LORE_STATUS,
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
      'Default status is PROPOSED. Supports context_md / decision_md / consequences_md sections. ' +
      'depends_on_ids/supersedes_ids/component_ids/tags each REPLACE the full edge set on every call ' +
      '(diff against current, not additive) — omit a param to leave that edge set untouched.',
    {
      adr_id:           z.string().describe('e.g. "ADR-HND-022"'),
      name:             z.string().describe('short title'),
      status:           z.enum(['PROPOSED', 'ACCEPTED', 'DEPRECATED', 'SUPERSEDED']).optional(),
      date_created:     z.string().optional().describe('YYYY-MM-DD, defaults to today'),
      component_id:     z.string().optional().describe('e.g. "HND" for Hound — single legacy field, ignored if component_ids is set'),
      component_ids:    z.array(z.string()).optional().describe('multiple components, e.g. ["HND", "SHT"] — wins over component_id'),
      context_md:       z.string().optional(),
      decision_md:      z.string().optional(),
      consequences_md:  z.string().optional(),
      depends_on_ids:   z.array(z.string()).optional().describe('other adr_id this ADR depends on — creates DEPENDS_ON edges, replaces the full set'),
      supersedes_ids:   z.array(z.string()).optional().describe('adr_id(s) this ADR supersedes — creates SUPERSEDES edges FROM this adr TO each listed one, replaces the full set. Pair with status="SUPERSEDED" on the OLD adr_id (separate lore_create_adr call) to mark it retired.'),
      tags:             z.array(z.string()).optional().describe('free-text tags — upserts KnowTag + TAGGED_WITH edges, replaces the full set'),
      file_path:        z.string().optional().describe('source .md path relative to docs root, e.g. "engine/specs/adr/ADR-HND-022.md"'),
    },
    async ({ adr_id, name, status, date_created, component_id, component_ids, context_md, decision_md, consequences_md, depends_on_ids, supersedes_ids, tags, file_path }) => {
      try {
        return json(await lorePost('/lore/adr', {
          adr_id, name,
          status: status ?? null, date_created: date_created ?? null,
          component_id: component_id ?? null, component_ids: component_ids ?? null,
          context_md: context_md ?? null,
          decision_md: decision_md ?? null, consequences_md: consequences_md ?? null,
          depends_on_ids: depends_on_ids ?? null, supersedes_ids: supersedes_ids ?? null,
          tags: tags ?? null, file_path: file_path ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_update_adr',
    'Amend an EXISTING KnowADR — thin wrapper over the same endpoint as lore_create_adr, ' +
      'tailored for partial updates. name is still required (backend always writes it), everything ' +
      'else is safe to omit: unset context_md/decision_md/consequences_md/date_created/component_id/status ' +
      'are left UNTOUCHED (never wiped or reset to today). Use this to amend a single ADR section — ' +
      'e.g. only decision_md to fix a typo, or only status to mark SUPERSEDED — without resending the ' +
      'whole body. depends_on_ids/supersedes_ids/component_ids/tags still REPLACE the full edge set when passed.',
    {
      adr_id:           z.string().describe('existing ADR to amend, e.g. "ADR-HND-022"'),
      name:             z.string().describe('current/updated title — required by the backend on every write'),
      status:           z.enum(['PROPOSED', 'ACCEPTED', 'DEPRECATED', 'SUPERSEDED']).optional(),
      date_created:     z.string().optional().describe('YYYY-MM-DD — omit to leave the existing date untouched'),
      component_id:     z.string().optional().describe('single legacy field — omit to leave untouched, ignored if component_ids is set'),
      component_ids:    z.array(z.string()).optional().describe('multiple components — replaces the full set, omit to leave untouched'),
      context_md:       z.string().optional().describe('omit to leave the existing section untouched'),
      decision_md:      z.string().optional().describe('omit to leave the existing section untouched'),
      consequences_md:  z.string().optional().describe('omit to leave the existing section untouched'),
      depends_on_ids:   z.array(z.string()).optional().describe('replaces the full DEPENDS_ON edge set, omit to leave untouched'),
      supersedes_ids:   z.array(z.string()).optional().describe('replaces the full SUPERSEDES edge set, omit to leave untouched. Pair with status="SUPERSEDED" on the OLD adr_id (separate call) to mark it retired.'),
      tags:             z.array(z.string()).optional().describe('replaces the full tag set, omit to leave untouched'),
      file_path:        z.string().optional().describe('source .md path relative to docs root — omit to leave untouched'),
    },
    async ({ adr_id, name, status, date_created, component_id, component_ids, context_md, decision_md, consequences_md, depends_on_ids, supersedes_ids, tags, file_path }) => {
      try {
        return json(await lorePost('/lore/adr', {
          adr_id, name,
          status: status ?? null, date_created: date_created ?? null,
          component_id: component_id ?? null, component_ids: component_ids ?? null,
          context_md: context_md ?? null,
          decision_md: decision_md ?? null, consequences_md: consequences_md ?? null,
          depends_on_ids: depends_on_ids ?? null, supersedes_ids: supersedes_ids ?? null,
          tags: tags ?? null, file_path: file_path ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_link_adr_sprint',
    'Link (or unlink) a KnowADR to the KnowSprint that implements it via an IMPLEMENTED_IN edge. ' +
      'Feeds the adr slice implemented_in_ids field. Idempotent on add. Use action="remove" to unlink.',
    {
      adr_id:    z.string().describe('e.g. "ADR-HND-022"'),
      sprint_id: z.string().describe('implementing sprint, e.g. "SPRINT_GEOID_STRUCTURAL_ID"'),
      action:    z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ adr_id, sprint_id, action }) => {
      try {
        return json(await lorePost('/lore/adr/link', { adr_id, sprint_id, action: action ?? 'add' }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_link_adr_release',
    'Link (or unlink) a KnowADR to the KnowRelease it shipped in via an IMPLEMENTED_IN_RELEASE edge. ' +
      'Feeds the adr slice release_ids field. Pass git_project for multi-repo safety ' +
      '(matches release_uid = "{git_project}#{release_id}"; without it matches bare release_id). ' +
      'Idempotent on add. Use action="remove" to unlink.',
    {
      adr_id:      z.string().describe('e.g. "ADR-HND-022"'),
      release_id:  z.string().describe('e.g. "v1.0.24"'),
      git_project: z.string().optional().describe('GitHub project slug, e.g. "NooriUta/AIDA"'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ adr_id, release_id, git_project, action }) => {
      try {
        return json(await lorePost('/lore/adr/link', {
          adr_id, release_id, git_project: git_project ?? null, action: action ?? 'add',
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_rename_adr',
    'Rename an existing KnowADR to a new adr_id IN PLACE — all edges (DEPENDS_ON/SUPERSEDES/' +
      'BELONGS_TO/TAGGED_WITH/IMPLEMENTED_IN*/HAS_STATE) hang off the vertex and survive untouched; ' +
      'no orphan, no tombstone. Fails if new_adr_id already exists. ' +
      'Remember callers referencing the old id by string (docs, .md files) are NOT updated.',
    {
      adr_id:     z.string().describe('current id, e.g. "ADR-HND-022"'),
      new_adr_id: z.string().describe('new id, e.g. "ADR-HND-SCD2-MIGRATIONS"'),
    },
    async ({ adr_id, new_adr_id }) => {
      try {
        return json(await lorePost('/lore/adr/rename', { adr_id, new_adr_id }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_delete_adr',
    'PERMANENTLY delete a KnowADR: cascades edges first (ArcadeDB cannot DELETE VERTEX with edges), ' +
      'then its KnowADRHist rows, then the vertex. Irreversible — prefer status="DEPRECATED"/' +
      '"SUPERSEDED" via lore_update_adr for anything that was ever real; delete is for test ' +
      'artifacts and mistaken creations only.',
    { adr_id: z.string() },
    async ({ adr_id }) => {
      try {
        return json(await lorePost('/lore/adr/delete', { adr_id }));
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
      sprint_id:   z.string().describe('e.g. "SPRINT_HOUND_ROWSET_V2"'),
      pr_numbers:  z.array(z.number().int()).describe('PR numbers to append, e.g. [420, 421]'),
      git_project: z.string().optional()
        .describe('GitHub project slug, e.g. "NooriUta/aida-documentation" (default: NooriUta/AIDA)'),
    },
    async ({ sprint_id, pr_numbers, git_project }) => {
      try {
        return json(await lorePost('/lore/sprint/refs', {
          sprint_id, pr_numbers, git_project: git_project ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  // ── Release management ──────────────────────────────────────────────────

  server.tool(
    'lore_move_to_project',
    'Correct the git_project on a PR or release that was accidentally assigned to the wrong repo. ' +
      'For PRs: updates git_project, pr_uid, and re-wires the BELONGS_TO_PROJECT edge. ' +
      'For releases: updates git_project field.',
    {
      entity_type: z.enum(['pr', 'release']),
      id: z.string().describe(
        'For PR: pr_uid (e.g. "NooriUta/AIDA#420") or bare pr_number. ' +
        'For release: release_id (e.g. "v1.0.0") or release_uid (e.g. "NooriUta/AIDA#v1.0.0").'
      ),
      git_project: z.string().describe('correct project slug, e.g. "NooriUta/seidr-site"'),
    },
    async ({ entity_type, id, git_project }) => {
      try {
        return json(await lorePost('/lore/project/move', { entity_type, id, git_project }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_release',
    'Create a new KnowRelease vertex in system_aida_lore. ' +
      'If is_current=true, the previous current release is automatically cleared. ' +
      'Returns the created release_id and timestamp.',
    {
      release_id:     z.string().describe('release id, e.g. "v1.6.12"'),
      release_date:   z.string().optional().describe('YYYY-MM-DD; defaults to today'),
      git_tag:        z.string().optional(),
      type:           z.enum(['patch', 'minor', 'major']).optional(),
      description_md: z.string().optional().describe('changelog / release notes in Markdown'),
      is_current:     z.boolean().optional().default(false).describe('mark as current prod release'),
      week:           z.number().int().optional().describe('plan week number (relative to W0)'),
      git_project:    z.string().optional()
        .describe('GitHub project slug (default: NooriUta/AIDA)'),
    },
    async ({ release_id, release_date, git_tag, type, description_md, is_current, week, git_project }) => {
      try {
        return json(await lorePost('/lore/release', {
          release_id, release_date: release_date ?? null,
          git_tag: git_tag ?? null, type: type ?? null,
          description_md: description_md ?? null,
          is_current: is_current ?? false, week: week ?? null,
          git_project: git_project ?? null,
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
      git_project:    z.string().optional()
        .describe('GitHub project slug, e.g. "NooriUta/aida-documentation" (default: NooriUta/AIDA)'),
    },
    async ({ release_id, git_tag, release_date, description_md, is_current, git_project }) => {
      try {
        return json(await lorePost('/lore/release/update', {
          release_id,
          git_tag: git_tag ?? null,
          release_date: release_date ?? null,
          description_md: description_md ?? null,
          is_current: is_current ?? null,
          git_project: git_project ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_link_release',
    'Attach one or more SPRINTS to a release. ' +
      'Creates IMPLEMENTED_IN_RELEASE edges (KnowSprint → KnowRelease). ' +
      'Use when a sprint is done and shipped in a specific release. ' +
      'For linking PRs to a release use lore_link_release_pr instead.\n\n' +
      'MULTI-REPO: always pass git_project — release_uid = "{git_project}#{release_id}".',
    {
      release_id:  z.string().describe('target release version, e.g. "v1.6.11"'),
      sprint_ids:  z.array(z.string()).describe('sprint ids to attach, e.g. ["SPRINT_HOUND_ROWSET_V2"]'),
      git_project: z.string().describe('GitHub project slug, e.g. "NooriUta/AIDA"'),
    },
    async ({ release_id, sprint_ids, git_project }) => {
      try {
        return json(await lorePost('/lore/release/link', {
          release_id, sprint_ids, pr_numbers: [], git_project,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_link_release_pr',
    'Attach one or more PULL REQUESTS to a release. ' +
      'Upserts KnowPR vertices and creates SHIPPED_IN edges (KnowPR → KnowRelease). ' +
      'Use when you know which PRs were merged into a release. ' +
      'For linking sprints to a release use lore_link_release instead.\n\n' +
      'MULTI-REPO: always pass git_project — release_uid = "{git_project}#{release_id}".',
    {
      release_id:  z.string().describe('target release version, e.g. "v1.6.11"'),
      pr_numbers:  z.array(z.number().int()).describe('PR numbers to attach, e.g. [401, 402]'),
      git_project: z.string().describe('GitHub project slug, e.g. "NooriUta/AIDA"'),
    },
    async ({ release_id, pr_numbers, git_project }) => {
      try {
        return json(await lorePost('/lore/release/link', {
          release_id, sprint_ids: [], pr_numbers, git_project,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_unlink_release',
    'Remove IMPLEMENTED_IN_RELEASE (sprint→release) or SHIPPED_IN (PR→release) edges. ' +
      'Use to correct accidental double-links.',
    {
      release_id:  z.string().describe('target release version, e.g. "v1.6.11"'),
      git_project: z.string().describe('GitHub project slug, e.g. "NooriUta/AIDA"'),
      sprint_ids:  z.array(z.string()).optional().describe('sprint ids to unlink'),
      pr_numbers:  z.array(z.number().int()).optional().describe('PR numbers to unlink'),
    },
    async ({ release_id, git_project, sprint_ids, pr_numbers }) => {
      try {
        return json(await lorePost('/lore/release/unlink', {
          release_id, git_project,
          sprint_ids: sprint_ids ?? [],
          pr_numbers: pr_numbers ?? [],
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_spec',
    'Create or update a specification document (KnowSpec + SCD2 hist). Idempotent — upserts by ' +
      'spec_id. Body fields (content_md/version/summary) are written to the OPEN KnowSpecHist row ' +
      '(created when missing) — the row spec_by_id actually reads. Partial calls are SAFE: omitted ' +
      'fields are left untouched, never wiped. Mutates system_aida_lore.',
    {
      spec_id:      z.string().describe('unique spec id, e.g. "SPEC-AUTH-001"'),
      title:        z.string(),
      version:      z.string().optional().describe('e.g. "1.0.0"'),
      component_id: z.string().optional().describe('e.g. "AUTH"'),
      content_md:   z.string().optional().describe('spec body in Markdown'),
      summary:      z.string().optional().describe('short abstract shown in lists'),
      file_path:    z.string().optional().describe('source file path relative to docs root'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/spec', p)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_update_spec',
    'Amend an EXISTING KnowSpec — same endpoint as lore_create_spec, signature tailored for ' +
      'partial updates (mirror of lore_update_adr). title required by the backend on every write; ' +
      'everything else safe to omit — unset content_md/version/summary/component_id/file_path are ' +
      'left UNTOUCHED. Body fields land on the OPEN KnowSpecHist row (the one spec_by_id reads), ' +
      'not just the vertex. Use for version bumps and body amends without resending the whole spec.',
    {
      spec_id:      z.string().describe('existing spec to amend, e.g. "HOUND_GEOID_SPEC"'),
      title:        z.string().describe('current/updated title — required by the backend on every write'),
      version:      z.string().optional().describe('omit to leave untouched'),
      component_id: z.string().optional().describe('omit to leave untouched'),
      content_md:   z.string().optional().describe('omit to leave the existing body untouched'),
      summary:      z.string().optional().describe('omit to leave untouched'),
      file_path:    z.string().optional().describe('omit to leave untouched'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/spec', p)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_delete_spec',
    'Permanently delete a KnowSpec vertex by spec_id. Mutates system_aida_lore.',
    { spec_id: z.string() },
    async ({ spec_id }) => {
      try { return json(await lorePost('/lore/spec/delete', { spec_id })); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_quality_gate',
    'Create or update a QualityGate vertex. ' +
      'Idempotent — upserts by qg_id. Mutates system_aida_lore.',
    {
      qg_id:        z.string().describe('e.g. "QG-HOUND-listener-chain"'),
      name:         z.string(),
      description:  z.string().optional(),
      component_id: z.string().optional(),
      status:       z.string().optional().describe('e.g. "active", "draft", "deprecated"'),
      content_md:   z.string().optional().describe('gate body in Markdown'),
      sprint_id:    z.string().optional().describe('sprint this QG belongs to, e.g. "SPRINT_AUTH_REDESIGN"'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/quality-gate', p)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_runbook',
    'Create or update a KnowRunbook vertex. ' +
      'Idempotent — upserts by runbook_id. Mutates system_aida_lore.',
    {
      runbook_id:   z.string().describe('e.g. "RUNBOOK-ARCADEDB-BACKUP"'),
      name:         z.string(),
      area:         z.string().optional().describe('e.g. "recovery", "infra", "deploy", "ops", "auth", "db", "service"'),
      date_created: z.string().optional().describe('ISO date YYYY-MM-DD; defaults to today'),
      content_md:   z.string().optional().describe('runbook body in Markdown'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/runbook', p)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_doc',
    'Create or update a KnowDoc vertex (HTML documentation page or fragment). ' +
      'Idempotent — upserts by doc_id. Mutates system_aida_lore.',
    {
      doc_id:       z.string().describe('unique id, e.g. "engine_specs_auth" (/ → _)'),
      title:        z.string(),
      kind:         z.string().optional().describe('e.g. "page", "fragment", "guide", "reference", "research", "product", "site", "prompt"'),
      has_ext_deps: z.boolean().optional().describe('true when content references external CDN'),
      component_id: z.string().optional(),
      file_path:    z.string().optional(),
      content_html: z.string().optional().describe('HTML content (100 KB max)'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/doc', p)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_edit_task',
    'Edit one task OR a batch of tasks (title, note_md, effort_days). Updates the vertex and its ' +
      'open history row. Mutates the shared system_aida_lore.\n\n' +
      'Single: pass task_uid + title (+ optional note_md, effort_days).\n' +
      'Batch:  pass tasks=[{task_uid, title, note_md?, effort_days?}, ...] — all processed in one call, ' +
      'errors collected per-item without aborting the rest.',
    {
      task_uid:    z.string().optional().describe('single-mode: full task uid, e.g. "SPRINT_X/SH-1"'),
      title:       z.string().optional().describe('single-mode: new title'),
      note_md:     z.string().optional().describe('single-mode: Markdown note (replaces existing)'),
      effort_days: z.number().int().optional().describe('single-mode: estimated effort in person-days'),
      tasks: z.array(z.object({
        task_uid:    z.string(),
        title:       z.string(),
        note_md:     z.string().optional(),
        effort_days: z.number().int().optional(),
      })).optional().describe('batch-mode: array of {task_uid, title, note_md?, effort_days?}'),
    },
    async ({ task_uid, title, note_md, effort_days, tasks }) => {
      try {
        if (tasks && tasks.length > 0) {
          return json(await lorePost('/lore/task/edit/batch',
            tasks.map(t => ({ task_uid: t.task_uid, title: t.title, note_md: t.note_md ?? null, effort_days: t.effort_days ?? null }))));
        }
        if (!task_uid || !title) return err(new Error('provide either tasks[] (batch) or task_uid+title (single)'));
        return json(await lorePost('/lore/task/edit', { task_uid, title, note_md: note_md ?? null, effort_days: effort_days ?? null }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_component',
    'Create a new LoreComponent vertex (upsert by component_id). ' +
      'Use for brand-new components not yet in the knowledge graph. ' +
      'Mutates the shared system_aida_lore.',
    {
      component_id: z.string().describe('SHORT uppercase ID, e.g. OMILORE, MIMIR'),
      full_name:    z.string().optional().describe('Human-readable full name'),
      area:         z.string().optional().describe('Team area, e.g. platform, engine, frontend'),
      team:         z.string().optional().describe('Team slug'),
      game_icon:    z.string().optional().describe('game-icons.net slug, e.g. spell-book'),
      owner:        z.string().optional().describe('Owner login'),
      parent_id:    z.string().optional().describe('Parent component_id if this is a sub-component'),
    },
    async ({ component_id, full_name, area, team, game_icon, owner, parent_id }) => {
      try {
        return json(await lorePost('/lore/component/create', {
          component_id, full_name, area, team, game_icon, owner, parent_id,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_qg_job_task',
    'Upsert a QGJobTask vertex and wire a YIELDED edge from the parent QualityGate. ' +
      'Call after running a QG slice when an invariant FAILS. ' +
      'severity: "blocker" | "major" | "minor". status: "open" (new failure) | "resolved" (pass after open). ' +
      'Sets status="resolved" on previously open tasks for the same qg_id+inv_id when a PASS is recorded.',
    {
      job_id:   z.string().describe('unique run id, e.g. "QG-LINEAGE_INV-1_2026-06-30"'),
      qg_id:    z.string().describe('parent QualityGate id, e.g. "QG-LINEAGE"'),
      inv_id:   z.string().optional().describe('invariant id, e.g. "INV-1"'),
      run_date: z.string().optional().describe('YYYY-MM-DD; defaults to today'),
      severity: z.enum(['blocker', 'major', 'minor']).optional().default('major'),
      status:   z.enum(['open', 'resolved']).optional().default('open'),
      note_md:  z.string().optional().describe('failure details / evidence in Markdown'),
    },
    async ({ job_id, qg_id, inv_id, run_date, severity, status, note_md }) => {
      try {
        return json(await lorePost('/lore/qg/job-task', {
          job_id, qg_id, inv_id: inv_id ?? null,
          run_date: run_date ?? new Date().toISOString().slice(0, 10),
          severity: severity ?? 'major', status: status ?? 'open',
          note_md: note_md ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_recommendation',
    'Upsert a QGRecommendation vertex and wire a PRODUCED edge from the parent QGJobTask. ' +
      'Call after lore_create_qg_job_task when you want to suggest a remediation action. ' +
      'Status starts as "pending" until the user confirms via lore_promote_recommendation. ' +
      'Always fill priority, severity, effort_days, fix_cmd and how_to_verify — sparse recs are useless.',
    {
      rec_id:        z.string().describe('unique id, e.g. "REC-QG-SECURITY-INV9-2026-06-30"'),
      job_id:        z.string().describe('parent QGJobTask job_id'),
      title:         z.string().describe('short action title — include QG id and INV id'),
      body_md:       z.string().optional().describe('## Проблема / ## Что сделать / ## Как проверить / ## Риск'),
      status:        z.enum(['pending', 'dismissed', 'promoted']).optional().default('pending'),
      priority:      z.enum(['P0', 'P1', 'P2']).optional().describe('P0=blocking, P1=this sprint, P2=backlog'),
      severity:      z.enum(['critical', 'high', 'medium', 'low']).optional(),
      effort_days:   z.number().optional().describe('estimated fix effort in days, e.g. 0.25'),
      tags:          z.string().optional().describe('comma-separated, e.g. "security,credentials"'),
      component_id:  z.string().optional().describe('LoreComponent component_id that owns the fix'),
      qg_id:         z.string().optional().describe('source QualityGate qg_id'),
      inv_id:        z.string().optional().describe('failed invariant id, e.g. "INV-9"'),
      fix_cmd:       z.string().optional().describe('one-liner bash command to apply the fix'),
      how_to_verify: z.string().optional().describe('bash command or check to confirm fix is done'),
    },
    async ({ rec_id, job_id, title, body_md, status, priority, severity, effort_days,
             tags, component_id, qg_id, inv_id, fix_cmd, how_to_verify }) => {
      try {
        return json(await lorePost('/lore/qg/recommendation', {
          rec_id, job_id, title,
          body_md:       body_md       ?? null,
          status:        status        ?? 'pending',
          priority:      priority      ?? null,
          severity:      severity      ?? null,
          effort_days:   effort_days   ?? null,
          tags:          tags          ?? null,
          component_id:  component_id  ?? null,
          qg_id:         qg_id         ?? null,
          inv_id:        inv_id        ?? null,
          fix_cmd:       fix_cmd       ?? null,
          how_to_verify: how_to_verify ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_record_qg_run',
    'Record a completed QG routine run with metrics into LORE (ClRoutineRun + ClRoutineMetric). ' +
      'Call once at the end of each QG routine run. routine_name must match the QG slug pattern ' +
      '(e.g. "qg-auth", "qg-security-demo", "qg-lineage"). ' +
      'metrics[] is the list of measured values — include all key indicators so the Analytics QG tab can display them. ' +
      'Common metric keys: coverage_pct, build_result (1/0), slo_p95_ms, violations_count, tests_passed, tests_failed, arch_enforced_pct.',
    {
      routine_name: z.string().describe('QG routine slug, e.g. "qg-auth"'),
      run_date:     z.string().describe('ISO date YYYY-MM-DD'),
      status:       z.enum(['OK', 'WARN', 'FAIL', 'PARTIAL']).describe('Overall run result'),
      started_at:   z.string().optional().describe('ISO datetime when run started'),
      finished_at:  z.string().optional().describe('ISO datetime when run finished'),
      flags:        z.string().optional().describe('Comma-separated flag strings, e.g. "coverage_low,shuttle_down"'),
      run_id:       z.string().optional().describe('Explicit run ID; auto-generated as routine_name+run_date if omitted'),
      metrics: z.array(z.object({
        key:    z.string().describe('Metric key, e.g. "inv_2_safecall_count" (one per invariant)'),
        value:  z.number().describe('Numeric value (grep count / HTTP status / ms / ratio; -1 = SKIP/service down)'),
        unit:   z.string().optional().describe('Unit: "count" | "ratio" | "ms" | "bool" | "lines" | "pct"'),
        target: z.number().optional().describe('Target/threshold value'),
        status: z.enum(['PASS', 'WARN', 'FAIL', 'SKIP']).optional().describe('Per-metric status vs target'),
        source: z.string().optional().describe('Exact reproducer command + file:line evidence, e.g. "grep -n safeCall CompositeListener.java → lines 47,89 (=5, want 8)". Drives _qg_recommend.'),
      })).optional().describe('List of measured metrics for this run — one per invariant, with evidence in source'),
    },
    async ({ routine_name, run_date, status, started_at, finished_at, flags, run_id, metrics }) => {
      return json(await lorePost('/lore/qg/run', {
        routine_name, run_date, status,
        started_at:  started_at  ?? null,
        finished_at: finished_at ?? null,
        flags:       flags       ?? null,
        run_id:      run_id      ?? null,
        metrics:     metrics     ?? [],
      }));
    },
  );

  server.tool(
    'lore_promote_recommendation',
    'Confirm a QGRecommendation and promote it to a KnowTask. Default target is a rotating ' +
      'weekly housekeeping sprint derived from the ISO calendar week — "SPRINT_QG_HOUSEKEEPING_' +
      '<year>W<week>" (e.g. SPRINT_QG_HOUSEKEEPING_2026W27) — auto-created (active, on the Plan ' +
      'board) the first time it is used that week, so tasks don\'t pile up forever in one bucket. ' +
      'Pass sprint_id to override. Creates PROMOTED_TO edge (QGRecommendation → KnowTask) and ' +
      'marks rec as "promoted". Backend auto-assigns task_id (T01, T02…), reads body_md/priority/' +
      'severity/fix_cmd/how_to_verify/component_id from the recommendation and builds a rich ' +
      'note_md automatically. Omit title/note_md to let the backend enrich from rec fields. ' +
      'Use after the user explicitly says "да" / confirms the recommendation.',
    {
      rec_id:    z.string().describe('QGRecommendation rec_id to promote'),
      sprint_id: z.string().optional().describe('target sprint; omit to use/auto-create this week\'s SPRINT_QG_HOUSEKEEPING_<ISO week>'),
      task_uid:  z.string().optional().describe('KnowTask uid; defaults to "<sprint_id>/T<NN>"'),
      title:     z.string().optional().describe('override task title (default: rec title)'),
      note_md:   z.string().optional().describe('override task description (default: auto-built from rec fields)'),
    },
    async ({ rec_id, sprint_id, task_uid, title, note_md }) => {
      try {
        return json(await lorePost('/lore/qg/promote', {
          rec_id, sprint_id: sprint_id ?? null,
          task_uid: task_uid ?? null, title: title ?? null, note_md: note_md ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_update_component',
    'Update metadata fields on an existing LoreComponent vertex (partial update — only supplied fields written). ' +
      'Covers full_name, area, team, game_icon, owner, parent_id. ' +
      'Use to rename, re-assign owner/team, fix icon slug, or reparent a component. ' +
      'Does NOT create a new component — use lore_create_component for that.',
    {
      component_id: z.string().describe('ID of the component to update, e.g. "FORSETI"'),
      full_name:    z.string().optional().describe('Human-readable full name'),
      area:         z.string().optional().describe('Team area, e.g. platform, engine, frontend'),
      team:         z.string().optional().describe('Team slug'),
      game_icon:    z.string().optional().describe('game-icons.net slug, e.g. spell-book'),
      owner:        z.string().optional().describe('Owner login'),
      parent_id:    z.string().optional().describe('Parent component_id if this is a sub-component'),
    },
    async ({ component_id, full_name, area, team, game_icon, owner, parent_id }) => {
      try {
        return json(await lorePost('/lore/component/update', {
          component_id, full_name: full_name ?? null, area: area ?? null,
          team: team ?? null, game_icon: game_icon ?? null,
          owner: owner ?? null, parent_id: parent_id ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

}
